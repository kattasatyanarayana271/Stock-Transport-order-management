import cds from '@sap/cds';

const { SELECT, INSERT, UPDATE } = cds.ql;

const ROLES = { USER: 'STOUser', APPROVER: 'STOApprover', SENIOR: 'STOSeniorApprover', ADMIN: 'STOAdmin' };
const HIGH_LEVEL_QTY = 1000;   // any item quantity above this requires high-level approval
const ITEM_STEP = 1;           // item numbers: 1, 2, 3 ...  (set to 10 for 10, 20, 30)
const NUMBER_PREFIX = 'STO-';
const NUMBER_START = 100001;  // STO-1000001, STO-1000002, ...
const FC_MANDATORY = 7, FC_READONLY = 1; // Common.FieldControlType values

const TRANSITIONS = {
  submit:   { from: ['Draft'],              to: 'Submitted' },
  withdraw: { from: ['Submitted'],          to: 'Draft' },
  approve:  { from: ['Submitted'],          to: 'Approved' },
  reject:   { from: ['Submitted'],          to: 'Rejected' },
  cancel:   { from: ['Draft', 'Approved'],  to: 'Cancelled' },
  complete: { from: ['Approved'],           to: 'Completed' }
};
const STATUS_CRITICALITY   = { Draft: 0, Submitted: 2, Approved: 3, Rejected: 1, Completed: 3, Cancelled: 1 };
const PRIORITY_CRITICALITY = { Normal: 0, High: 2, Urgent: 1 };

const keyOf = req => {
  const p = req.params?.at(-1);
  return p && typeof p === 'object' ? p.ID : p;
};
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

export default class StoreService extends cds.ApplicationService {
  async init() {
    await super.init(); // generic handlers (input validation, @readonly, managed ...) first

    const srv = this;
    this.before('*', req => console.log('USER:', req.user.id, [...Object.keys(req.user.roles ?? {})]));
    const { STOs, STOItems } = this.entities;
    const {
      STOs: dbSTOs, STOItems: dbItems, STOStatusHistory: dbHistory,
      PlantStocks: dbStock, Plants: dbPlants, Materials: dbMaterials, UOMs: dbUOMs
    } = cds.entities('sto');

    // ------------------------------------------------------------ helpers
    /** STO-1000001, STO-1000002 ... (highest existing 7-digit number + 1) */
    const nextNumber = async () => {
  const rows = await SELECT.from(dbSTOs)
    .columns('stoNumber');

  let maxNumber = NUMBER_START - 1;

  for (const row of rows) {
    if (!row.stoNumber?.startsWith(NUMBER_PREFIX)) continue;

    const n = Number(
      row.stoNumber.slice(NUMBER_PREFIX.length)
    );

    if (Number.isInteger(n) && n > maxNumber) {
      maxNumber = n;
    }
  }

  return `${NUMBER_PREFIX}${maxNumber + 1}`;
};

    /** gives every item without a number the next free one */
    const assignItemNumbers = items => {
      let n = Math.max(0, ...items.map(i => Number(i.itemNumber) || 0));
      for (const it of items) if (!it.itemNumber) { n += ITEM_STEP; it.itemNumber = n; }
    };

    const addHistory = (stoID, oldStatus, newStatus, user, comments) =>
      INSERT.into(dbHistory).entries({ sto_ID: stoID, oldStatus, newStatus, changedBy: user, changedAt: now(), comments });

    const assertEditable = (req, sto, what = 'edited') => {
      if (sto.status !== 'Draft')
        req.reject(409, `STO ${sto.stoNumber} cannot be ${what === 'items' ? 'changed (items)' : what} because its current status is ${sto.status}. Only Draft STOs can be modified.`);
    };

    /** Header rules 1, 7, 10, 11. Returns [{message,target}] */
    const validateHeader = async (h, checkPlants = []) => {
      const errs = [];
      const add = (message, target) => errs.push({ message, target });

      if (!h.sourcePlant_code) add('Source Plant is mandatory.', 'sourcePlant_code');
      if (!h.destinationPlant_code) add('Destination Plant is mandatory.', 'destinationPlant_code');
      if (h.sourcePlant_code && h.sourcePlant_code === h.destinationPlant_code)
        add('Source Plant and Destination Plant cannot be the same.', 'destinationPlant_code');

      for (const [field, label] of [['sourcePlant_code', 'Source'], ['destinationPlant_code', 'Destination']]) {
        const code = h[field];
        if (!code || !checkPlants.includes(field)) continue;
        const p = await SELECT.one.from(dbPlants).where({ code });
        if (!p) add(`${label} Plant ${code} does not exist.`, field);
        else if (p.status !== 'Active') add(`${label} Plant ${code} is inactive and cannot be used for a new STO.`, field);
      }

      if (!h.requestedDeliveryDate) add('Requested Delivery Date is mandatory.', 'requestedDeliveryDate');
      else if (h.stoDate && String(h.requestedDeliveryDate) < String(h.stoDate))
        add(`Requested Delivery Date ${h.requestedDeliveryDate} cannot be earlier than STO Date ${h.stoDate}.`, 'requestedDeliveryDate');

      if (!['Normal', 'High', 'Urgent'].includes(h.priority)) add('Priority must be Normal, High or Urgent.', 'priority');
      if (h.priority === 'Urgent' && !String(h.reason ?? '').trim())
        add('Reason is mandatory when Priority is Urgent (e.g. "Production shortage").', 'reason');
      return errs;
    };

    /** Item rules 3, 4, 6, 8, 9, 15. Mutates items (sets materialDescription). */
    const validateItems = async (items, sourcePlant, { prior = new Set(), single = false } = {}) => {
      const errs = [];
      const seen = new Set(prior);
      for (const [i, it] of items.entries()) {
        const label = `Item ${it.itemNumber ?? i + 1}`;
        const add = (message, field) => errs.push({ message, target: single ? field : undefined });
        let mat;

        if (!it.material_code) add(`Material is mandatory for ${label}.`, 'material_code');
        else {
          mat = await SELECT.one.from(dbMaterials).where({ code: it.material_code });
          if (!mat) { add(`Material ${it.material_code} does not exist.`, 'material_code'); mat = undefined; }
          else if (mat.status !== 'Active') { add(`Material ${it.material_code} is inactive and cannot be used in an STO.`, 'material_code'); mat = undefined; }
          else it.materialDescription = mat.description;

          if (seen.has(it.material_code)) add(`Material ${it.material_code} already exists in this STO.`, 'material_code');
          seen.add(it.material_code);
        }

        const qty = Number(it.quantity);
        if (!(qty > 0)) add('Quantity must be greater than zero.', 'quantity');

        if (!it.uom_code) add(`UOM is mandatory for ${label}.`, 'uom_code');
        else if (!(await SELECT.one.from(dbUOMs).where({ code: it.uom_code })))
          add(`UOM ${it.uom_code} does not exist.`, 'uom_code');

        if (mat && sourcePlant && qty > 0) {
          const s = await SELECT.one.from(dbStock).where({ plant_code: sourcePlant, material_code: it.material_code });
          const avail = Number(s?.availableStock ?? 0);
          if (qty > avail)
            add(`Requested quantity ${qty} exceeds available stock ${avail} at source plant ${sourcePlant}.`, 'quantity');
        }
      }
      return errs;
    };

    const raise = (req, errs) => errs.forEach(e => req.error({ status: 400, message: e.message, target: e.target }));
    const joinMsgs = errs => errs.map(e => e.message).join(' ');

    // ------------------------------------------------- draft: NEW defaults
    if (STOs.drafts) {
      // STO date + requester are visible (read-only) as soon as the user clicks Create
      this.before('NEW', STOs.drafts, req => {
        req.data.stoDate = today();
        req.data.requestedBy = req.user.id;
      });
    }
    

    // ------------------------------------------------- STO header handlers
    this.before('CREATE', STOs, async req => {
      const d = req.data;
      Object.assign(d, {
        stoNumber: await nextNumber(), stoDate: today(), requestedBy: req.user.id,
        status: 'Draft', approvalLevel: 'Standard', rejectionReason: null, approvedBy: null, approvedAt: null
      });
      if (d.priority !== 'Urgent') d.reason = null;   // reason only applies to Urgent STOs
      const items = d.items ?? [];
      assignItemNumbers(items);
      const errs = [
        ...(await validateHeader(d, ['sourcePlant_code', 'destinationPlant_code'])),
        ...(await validateItems(items, d.sourcePlant_code))
      ];
      raise(req, errs);
    });

    this.after('CREATE', STOs, (data, req) => addHistory(data.ID, null, 'Draft', req.user.id, 'Created'));

    this.before('UPDATE', STOs, async req => {
      const d = req.data;
      const id = d.ID ?? keyOf(req);
      const cur = await SELECT.one.from(dbSTOs).where({ ID: id });
      if (!cur) return req.reject(404, `STO ${id} not found.`);
      assertEditable(req, cur);

      const merged = { ...cur, ...d };
      if (merged.priority !== 'Urgent') d.reason = merged.reason = null;
      const changedPlants = ['sourcePlant_code', 'destinationPlant_code'].filter(f => f in d && d[f] !== cur[f]);
      const errs = await validateHeader(merged, changedPlants);
      if (Array.isArray(d.items)) {
        assignItemNumbers(d.items);
        errs.push(...(await validateItems(d.items, merged.sourcePlant_code)));
      }
      raise(req, errs);
    });

    this.before('DELETE', STOs, async req => {
      const id = req.data?.ID ?? keyOf(req);
      const cur = await SELECT.one.from(dbSTOs).where({ ID: id });
      if (cur && cur.status !== 'Draft')
        req.reject(409, `STO ${cur.stoNumber} cannot be deleted because its current status is ${cur.status}. Only Draft STOs can be deleted.`);
    });

    // Draft: only Draft-status STOs may be opened for editing
    this.before('EDIT', STOs, async req => {
      const cur = await SELECT.one.from(dbSTOs).where({ ID: req.data.ID ?? keyOf(req) });
      if (cur) assertEditable(req, cur);
    });

    // ------------------------------------- draft items: number + live checks
    if (STOItems.drafts) {
      // automatic item number (read-only in the UI)
      this.before('NEW', STOItems.drafts, async req => {
        const stoID = req.data.sto_ID ?? keyOf(req);
        const rows = await SELECT.from(STOItems.drafts).columns('itemNumber').where({ sto_ID: stoID });
        req.data.itemNumber = Math.max(0, ...rows.map(r => Number(r.itemNumber) || 0)) + ITEM_STEP;
      });

      // validate the fields the user just changed (material, quantity > 0, duplicate, stock)
      this.before('PATCH', STOItems.drafts, async req => {
        const id = req.data.ID ?? keyOf(req);
        const cur = await SELECT.one.from(STOItems.drafts).where({ ID: id });
        if (!cur) return;
        const merged = { ...cur, ...req.data };

        if ('material_code' in req.data && !req.data.material_code) req.data.materialDescription = null;
        if (req.data.material_code && !merged.uom_code) {          // default UOM = material base UOM
          const m = await SELECT.one.from(dbMaterials).where({ code: req.data.material_code });
          if (m?.baseUOM_code) req.data.uom_code = merged.uom_code = m.baseUOM_code;
        }

        const parent = await SELECT.one.from(STOs.drafts).columns('sourcePlant_code').where({ ID: cur.sto_ID });
        const siblings = (await SELECT.from(STOItems.drafts).columns('ID', 'material_code').where({ sto_ID: cur.sto_ID }))
          .filter(s => s.ID !== id);
        const errs = await validateItems([merged], parent?.sourcePlant_code, {
          prior: new Set(siblings.map(s => s.material_code).filter(Boolean)), single: true
        });
        if (merged.materialDescription && merged.materialDescription !== cur.materialDescription)
          req.data.materialDescription = merged.materialDescription;

        // only report problems for the fields touched now (an empty quantity must not block picking a material)
        const touched = Object.keys(req.data);
        raise(req, errs.filter(e =>
          touched.includes(e.target) ||
          (touched.includes('material_code') && e.target === 'quantity' && e.message.includes('exceeds available stock'))));
      });
    }

    // Active items (direct REST on an existing Draft-status STO)
    this.before(['CREATE', 'UPDATE', 'DELETE'], STOItems, async req => {
      const isCreate = req.event === 'CREATE';
      const itemID = isCreate ? null : (req.data?.ID ?? keyOf(req));
      const current = itemID ? await SELECT.one.from(dbItems).where({ ID: itemID }) : null;
      if (!isCreate && !current) return req.reject(404, 'STO item not found.');

      const stoID = current?.sto_ID ?? req.data.sto_ID ?? keyOf(req);
      const sto = stoID ? await SELECT.one.from(dbSTOs).where({ ID: stoID }) : null;
      if (!sto) return req.reject(404, 'Items can only be maintained as part of an existing STO.');
      assertEditable(req, sto, 'items');
      if (req.event === 'DELETE') return;

      const others = (await SELECT.from(dbItems).where({ sto_ID: stoID })).filter(i => i.ID !== itemID);
      const merged = { ...current, ...req.data };
      if (isCreate) {
        merged.itemNumber = Math.max(0, ...others.map(o => Number(o.itemNumber) || 0)) + ITEM_STEP;
        req.data.itemNumber = merged.itemNumber;
      }
      const errs = await validateItems([merged], sto.sourcePlant_code, {
        prior: new Set(others.map(o => o.material_code)), single: true
      });
      if (merged.materialDescription) req.data.materialDescription = merged.materialDescription;
      raise(req, errs);
    });

    // ------------------------------------------ UI helper (virtual) fields
    const forceColumns = cols => req => {
      const sel = req.query?.SELECT;
      if (!sel || sel.groupBy || !sel.columns) return;
      if (sel.columns.some(c => c === '*' || c.func || c.xpr)) return;
      for (const f of cols)
        if (!sel.columns.some(c => c.ref?.length === 1 && c.ref[0] === f)) sel.columns.push({ ref: [f] });
    };
    this.before('READ', STOs, forceColumns(['status', 'approvalLevel', 'priority']));

    this.after('READ', STOs, (rows, req) => {
      const u = req.user;
      const isUser = u.is(ROLES.USER), isApprover = u.is(ROLES.APPROVER), isSenior = u.is(ROLES.SENIOR);
      for (const r of [rows].flat()) {
        if (!r || typeof r !== 'object' || r.status === undefined) continue;
        const s = r.status;
        const mayDecide = isApprover && (r.approvalLevel !== 'High-Level' || isSenior);
        r.statusCriticality   = STATUS_CRITICALITY[s] ?? 0;
        r.priorityCriticality = PRIORITY_CRITICALITY[r.priority] ?? 0;
        r.reasonControl = r.priority === 'Urgent' ? FC_MANDATORY : FC_READONLY;
        r.isEditable   = s === 'Draft' && isUser;
        r.canSubmit    = s === 'Draft' && isUser;
        r.canWithdraw  = s === 'Submitted' && isUser;
        r.canApprove   = s === 'Submitted' && mayDecide;
        r.canReject    = s === 'Submitted' && mayDecide;
        r.canCancel    = (s === 'Draft' || s === 'Approved') && (isUser || isApprover);
        r.canComplete  = s === 'Approved' && (isUser || isApprover);
      }
    });

    // Rows of an open draft are always editable; 'reason' is enabled only for Urgent
    if (STOs.drafts) {
      this.before('READ', STOs.drafts, forceColumns(['priority']));
      this.after('READ', STOs.drafts, rows => {
        for (const r of [rows].flat()) {
          if (!r || typeof r !== 'object') continue;
          r.isEditable = true;
          r.statusCriticality = 0;
          r.priorityCriticality = PRIORITY_CRITICALITY[r.priority] ?? 0;
          r.reasonControl = r.priority === 'Urgent' ? FC_MANDATORY : FC_READONLY;
        }
      });
    }

    // ------------------------------------------------------------ actions
    const load = async (req, action) => {
      const id = keyOf(req);
      const sto = await SELECT.one.from(dbSTOs).where({ ID: id });
      if (!sto) req.reject(404, `STO ${id} not found.`);
      if (!TRANSITIONS[action].from.includes(sto.status))
        req.reject(409, `Cannot ${action} STO ${sto.stoNumber} because its current status is ${sto.status}.`);
      const items = await SELECT.from(dbItems).where({ sto_ID: id }).orderBy('itemNumber');
      return { id, sto, items };
    };

    const apply = async (req, { id, sto }, action, extra = {}, comments = '') => {
      const newStatus = TRANSITIONS[action].to;
      await UPDATE(dbSTOs).set({ status: newStatus, modifiedAt: now(), modifiedBy: req.user.id, ...extra }).where({ ID: id });
      await addHistory(id, sto.status, newStatus, req.user.id, comments);
      return srv.run(SELECT.one.from(STOs).where({ ID: id }));
    };

    const stockKey = (plant, material) => ({ plant_code: plant, material_code: material });

    this.on('submit', STOs, async req => {
      const ctx = await load(req, 'submit');
      const { sto, items } = ctx;
      if (!items.length) return req.reject(400, 'Please add at least one material before submitting the STO.');
      const errs = [
        ...(await validateHeader(sto, ['sourcePlant_code', 'destinationPlant_code'])),
        ...(await validateItems(items.map(i => ({ ...i })), sto.sourcePlant_code))
      ];
      if (errs.length) return req.reject(400, joinMsgs(errs));
      const high = items.some(i => Number(i.quantity) > HIGH_LEVEL_QTY);
      return apply(req, ctx, 'submit',
        { approvalLevel: high ? 'High-Level' : 'Standard', rejectionReason: null },
        high ? `Submitted for approval (quantity > ${HIGH_LEVEL_QTY}: high-level approval required)` : 'Submitted for approval');
    });

    this.on('withdraw', STOs, async req => {
      const ctx = await load(req, 'withdraw');
      return apply(req, ctx, 'withdraw', {}, 'Withdrawn by requester');
    });

    this.on('approve', STOs, async req => {
      const ctx = await load(req, 'approve');
      const { sto, items } = ctx;
      if (sto.approvalLevel === 'High-Level' && !req.user.is(ROLES.SENIOR))
        return req.reject(403, `STO ${sto.stoNumber} contains quantities above ${HIGH_LEVEL_QTY} and needs high-level approval (role ${ROLES.SENIOR}).`);

      // reserve stock (atomic check + move available -> reserved); request rolls back on failure
      for (const it of items) {
        const q = Number(it.quantity);
        const key = stockKey(sto.sourcePlant_code, it.material_code);
        const n = await UPDATE(dbStock)
          .set({ availableStock: { '-=': q }, reservedStock: { '+=': q } })
          .where({ ...key, availableStock: { '>=': q } });
        if (!n) {
          const s = await SELECT.one.from(dbStock).where(key);
          return req.reject(409, `Cannot approve STO ${sto.stoNumber}: requested quantity ${q} of ${it.material_code} exceeds available stock ${Number(s?.availableStock ?? 0)} at source plant ${sto.sourcePlant_code}.`);
        }
      }
      return apply(req, ctx, 'approve', { approvedBy: req.user.id, approvedAt: now(), rejectionReason: null }, 'Approved, stock reserved');
    });

    this.on('reject', STOs, async req => {
      const reason = req.data.reason?.trim();
      if (!reason) return req.reject(400, 'Rejection Reason is mandatory.');
      const ctx = await load(req, 'reject');
      return apply(req, ctx, 'reject', { rejectionReason: reason }, `Rejected: ${reason}`);
    });

    this.on('cancel', STOs, async req => {
      const ctx = await load(req, 'cancel');
      const { sto, items } = ctx;
      if (sto.status === 'Approved') { // release reservation
        for (const it of items) {
          const q = Number(it.quantity);
          await UPDATE(dbStock).set({ availableStock: { '+=': q }, reservedStock: { '-=': q } })
            .where(stockKey(sto.sourcePlant_code, it.material_code));
        }
      }
      const reason = req.data.reason?.trim();
      return apply(req, ctx, 'cancel', {}, reason ? `Cancelled: ${reason}` : 'Cancelled');
    });

    this.on('complete', STOs, async req => {
      const ctx = await load(req, 'complete');
      const { sto, items } = ctx;
      for (const it of items) {
        const q = Number(it.quantity);
        await UPDATE(dbStock).set({ reservedStock: { '-=': q } }).where(stockKey(sto.sourcePlant_code, it.material_code));
        const dest = stockKey(sto.destinationPlant_code, it.material_code);
        const n = await UPDATE(dbStock).set({ availableStock: { '+=': q } }).where(dest);
        if (!n) await INSERT.into(dbStock).entries({ ...dest, availableStock: q, reservedStock: 0 });
      }
      return apply(req, ctx, 'complete', {}, req.data.comments?.trim() || 'Transfer completed');
    });

    // ---------------------------------------------------------------- KPIs
    this.on('getKPIs', async () => {
      const rows = await SELECT.from(dbSTOs).columns('status', 'count(*) as count').groupBy('status');
      const c = Object.fromEntries(rows.map(r => [r.status, Number(r.count)]));
      return {
        total: rows.reduce((a, r) => a + Number(r.count), 0),
        draft: c.Draft ?? 0, submitted: c.Submitted ?? 0, approved: c.Approved ?? 0,
        rejected: c.Rejected ?? 0, completed: c.Completed ?? 0, cancelled: c.Cancelled ?? 0
      };
    });
  }
}
