namespace sto;

using { cuid, managed } from '@sap/cds/common';

type StoStatus   : String(12) enum { Draft; Submitted; Approved; Rejected; Completed; Cancelled; };
type StoPriority : String(10) enum { Normal; High; Urgent; };
type MasterStatus: String(10) enum { Active; Inactive; };
type Quantity    : Decimal(13, 3);

/** Unit of measure master */
entity UOMs {
  key code        : String(3);
      description : String(40);
}

/** Plant master - only Active plants selectable for new STOs */
entity Plants {
  key code     : String(4);
      name     : String(60);
      location : String(60);
      country  : String(40);
      status   : MasterStatus default 'Active';
}

/** Material master - only Active materials selectable */
entity Materials {
  key code         : String(20);
      description  : String(100);
      materialType : String(30);
      baseUOM      : Association to UOMs;
      status       : MasterStatus default 'Active';
}

/** Mock stock per plant/material (no S/4HANA integration needed) */
entity PlantStocks {
  key plant          : Association to Plants;
  key material       : Association to Materials;
      availableStock : Quantity default 0;
      reservedStock  : Quantity default 0;
}

/** Code lists used for value helps / filters */
entity Priorities { key code : String(10); name : String(40); }
entity Statuses   { key code : String(12); name : String(40); }

/** STO header. managed => createdAt/By, modifiedAt/By */
entity STOs : cuid, managed {
  stoNumber             : String(12);
  stoDate               : Date;
  sourcePlant           : Association to Plants;
  destinationPlant      : Association to Plants;
  requestedBy           : String(100);
  requestedDeliveryDate : Date;
  priority              : StoPriority default 'Normal';
  reason                : String(255);
  remarks               : String(500);
  status                : StoStatus default 'Draft';
  rejectionReason       : String(500);
  approvalLevel         : String(12) default 'Standard'; // Standard | High-Level
  approvedBy            : String(100);
  approvedAt            : Timestamp;
  items                 : Composition of many STOItems on items.sto = $self;
  history               : Composition of many STOStatusHistory on history.sto = $self;

  // UI helper fields, calculated in the service layer (not persisted)
  virtual statusCriticality   : Integer;
  virtual priorityCriticality : Integer;
  virtual reasonControl       : Integer;
  virtual isEditable          : Boolean;
  virtual canSubmit           : Boolean;
  virtual canWithdraw         : Boolean;
  virtual canApprove          : Boolean;
  virtual canReject           : Boolean;
  virtual canCancel           : Boolean;
  virtual canComplete         : Boolean;
}

entity STOItems : cuid {
  sto                 : Association to STOs;
  itemNumber          : Integer;
  material            : Association to Materials;
  materialDescription : String(100);
  quantity            : Integer;
  uom                 : Association to UOMs;
  batch               : String(20);
  remarks             : String(255);
}

/** Audit trail of status changes */
entity STOStatusHistory : cuid {
  sto       : Association to STOs;
  oldStatus : String(12);
  newStatus : String(12);
  changedBy : String(100);
  changedAt : Timestamp;
  comments  : String(500);
}
