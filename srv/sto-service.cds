using { sto as db } from '../db/schema';

@path: '/odata/v4/stores'
@requires: 'authenticated-user'
service StoreService {

  // ---------------------------------------------------------------- STO

  @cds.search: {
    stoNumber,
    reason,
    sourcePlant.code,
    sourcePlant.name,
    destinationPlant.code,
    destinationPlant.name,
    items.material.code,
    items.materialDescription
  }

  @restrict: [
    {
      grant: ['READ', 'CREATE', 'UPDATE', 'DELETE'],
      to: ['STOUser', 'STOApprover', 'STOAdmin']
    },
    {
      grant: ['submit', 'withdraw'],
      to: 'STOUser'
    },
    {
      grant: ['approve', 'reject'],
      to: 'STOApprover'
    },
    {
      grant: ['cancel', 'complete'],
      to: ['STOUser', 'STOApprover', 'STOAdmin']
    }
  ]

  @odata.draft.enabled
  entity STOs as projection on db.STOs {
    *,
    sourcePlant      : redirected to Plants,
    destinationPlant : redirected to Plants
  } actions {

    action submit()
      returns STOs;

    action withdraw()
      returns STOs;

    action approve()
      returns STOs;

    action reject(
      reason : String(500)
    )
      returns STOs;

    action cancel(
      reason : String(500)
    )
      returns STOs;

    action complete(
      comments : String(500)
    )
      returns STOs;
  };


  // ---------------------------------------------------------------- STO ITEMS

  @restrict: [
    {
      grant: 'READ',
      to: ['STOUser', 'STOApprover', 'STOAdmin']
    },
    {
      grant: ['CREATE', 'UPDATE', 'DELETE'],
      to: 'STOUser'
    }
  ]

  entity STOItems as projection on db.STOItems {
    *,
    material : redirected to Materials
  };


  // ---------------------------------------------------------------- HISTORY

  @readonly
  @requires: ['STOUser', 'STOApprover', 'STOAdmin']
  entity STOStatusHistory as projection on db.STOStatusHistory;


  // ---------------------------------------------------------------- MASTER DATA

  @restrict: [
    {
      grant: 'READ',
      to: ['STOUser', 'STOApprover', 'STOAdmin']
    },
    {
      grant: ['CREATE', 'UPDATE', 'DELETE'],
      to: 'STOAdmin'
    }
  ]

  entity Plants as projection on db.Plants;


  @restrict: [
    {
      grant: 'READ',
      to: ['STOUser', 'STOApprover', 'STOAdmin']
    },
    {
      grant: ['CREATE', 'UPDATE', 'DELETE'],
      to: 'STOAdmin'
    }
  ]

  entity Materials as projection on db.Materials;


  @restrict: [
    {
      grant: 'READ',
      to: ['STOUser', 'STOApprover', 'STOAdmin']
    },
    {
      grant: ['CREATE', 'UPDATE', 'DELETE'],
      to: 'STOAdmin'
    }
  ]

  entity UOMs as projection on db.UOMs;


  @restrict: [
    {
      grant: 'READ',
      to: ['STOUser', 'STOApprover', 'STOAdmin']
    },
    {
      grant: ['CREATE', 'UPDATE', 'DELETE'],
      to: 'STOAdmin'
    }
  ]

  entity PlantStocks as projection on db.PlantStocks {
    *,
    plant    : redirected to Plants,
    material : redirected to Materials
  };


  // ---------------------------------------------------------------- ACTIVE VALUE HELPS

  @readonly
  @requires: ['STOUser', 'STOApprover', 'STOAdmin']
  entity ActivePlants as projection on db.Plants
    where status = 'Active';


  @readonly
  @requires: ['STOUser', 'STOApprover', 'STOAdmin']
  entity ActiveMaterials as projection on db.Materials
    where status = 'Active';


  @readonly
  @requires: ['STOUser', 'STOApprover', 'STOAdmin']
  entity Priorities as projection on db.Priorities;


  @readonly
  @requires: ['STOUser', 'STOApprover', 'STOAdmin']
  entity Statuses as projection on db.Statuses;


  // ---------------------------------------------------------------- DASHBOARD

  type KPIResult {
    total     : Integer;
    draft     : Integer;
    submitted : Integer;
    approved  : Integer;
    rejected  : Integer;
    completed : Integer;
    cancelled : Integer;
  }


  @requires: ['STOUser', 'STOApprover', 'STOAdmin']
  function getKPIs()
    returns KPIResult;
}


// ============================================================================
// UI / FIELD CONTROL
// ============================================================================

annotate StoreService.STOs with {

  // System controlled fields
  stoNumber       @readonly;
  stoDate         @readonly;
  requestedBy     @readonly;
  status          @readonly;
  rejectionReason @readonly;
  approvalLevel   @readonly;
  approvedBy      @readonly;
  approvedAt      @readonly;


  // User input fields
  sourcePlant
    @mandatory;

  destinationPlant
    @mandatory;

  requestedDeliveryDate
    @mandatory;

  priority
    @mandatory;

  // Reason is mandatory only when Priority = Urgent
  // Therefore it is intentionally NOT marked @mandatory here.
};


annotate StoreService.STOItems with {

  itemNumber
    @readonly;

  materialDescription
    @readonly;

  material
    @mandatory;

  quantity
    @mandatory;

  uom
    @mandatory;
};