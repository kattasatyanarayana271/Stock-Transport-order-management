using StoreService as service from './sto-service';

// ====================================================================
// Labels, text arrangement and value helps
// ====================================================================
annotate service.STOs with {
  stoNumber             @title: 'STO Number'   @Common.FieldControl: #ReadOnly;
  stoDate               @title: 'STO Date'     @Common.FieldControl: #ReadOnly;
  requestedBy           @title: 'Requested By' @Common.FieldControl: #ReadOnly;
  requestedDeliveryDate @title: 'Requested Delivery Date';
  priority              @title: 'Priority';
  // enabled + mandatory only when Priority = Urgent (reasonControl is computed in the service)
  reason                @title: 'Reason'
                        @Common.FieldControl: { $edmJson: { $Path: 'reasonControl' } };
  remarks               @title: 'Remarks'  @UI.MultiLineText;
  status                @title: 'Status';
  rejectionReason       @title: 'Rejection Reason';
  approvalLevel         @title: 'Approval Level';
  approvedBy            @title: 'Approved By';
  approvedAt            @title: 'Approved At';
  createdAt             @title: 'Created At';
  createdBy             @title: 'Created By';
  modifiedAt            @title: 'Modified At';
  modifiedBy            @title: 'Modified By';

  sourcePlant @(
    title: 'Source Plant',
    Common.Text: sourcePlant.name, Common.TextArrangement: #TextFirst,
    Common.ValueList: {
      Label: 'Active Plants', CollectionPath: 'ActivePlants',
      Parameters: [
        { $Type: 'Common.ValueListParameterInOut',       LocalDataProperty: sourcePlant_code, ValueListProperty: 'code' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'location' }
      ]
    }
  );
  destinationPlant @(
    title: 'Destination Plant',
    Common.Text: destinationPlant.name, Common.TextArrangement: #TextFirst,
    Common.ValueList: {
      Label: 'Active Plants', CollectionPath: 'ActivePlants',
      Parameters: [
        { $Type: 'Common.ValueListParameterInOut',       LocalDataProperty: destinationPlant_code, ValueListProperty: 'code' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'location' }
      ]
    }
  );
  priority @Common.ValueListWithFixedValues: true @Common.ValueList: {
    CollectionPath: 'Priorities',
    Parameters: [ { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: priority, ValueListProperty: 'code' } ]
  };
  status @Common.ValueListWithFixedValues: true @Common.ValueList: {
    CollectionPath: 'Statuses',
    Parameters: [ { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: status, ValueListProperty: 'code' } ]
  };
}

annotate service.STOItems with {
  itemNumber          @title: 'Item'        @Common.FieldControl: #ReadOnly;
  materialDescription @title: 'Description' @Common.FieldControl: #ReadOnly;
  quantity            @title: 'Quantity';
  batch               @title: 'Batch';
  remarks             @title: 'Remarks';
  material @(
    title: 'Material',
    Common.Text: material.description, Common.TextArrangement: #TextLast,
    Common.ValueList: {
      Label: 'Active Materials', CollectionPath: 'ActiveMaterials',
      Parameters: [
        { $Type: 'Common.ValueListParameterInOut',       LocalDataProperty: material_code, ValueListProperty: 'code' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'description' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'materialType' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'baseUOM_code' }
      ]
    }
  );
  uom @(
    title: 'UOM',
    Common.ValueListWithFixedValues: true,
    Common.ValueList: {
      Label: 'Units of Measure', CollectionPath: 'UOMs',
      Parameters: [
        { $Type: 'Common.ValueListParameterInOut',       LocalDataProperty: uom_code, ValueListProperty: 'code' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'description' }
      ]
    }
  );
}

annotate service.STOStatusHistory with {
  oldStatus @title: 'Old Status';
  newStatus @title: 'New Status';
  changedBy @title: 'Changed By';
  changedAt @title: 'Changed At';
  comments  @title: 'Comments';
}

// ====================================================================
// Status-dependent behaviour (buttons enabled by the virtual can* flags)
// ====================================================================
annotate service.STOs with @(
  UI.UpdateHidden : { $edmJson: { $Not: { $Path: 'isEditable' } } },
  Capabilities.DeleteRestrictions.Deletable : { $edmJson: { $Path: 'isEditable' } },

  // when Priority changes, re-read the field control of 'reason'
  Common.SideEffects #PriorityChanged : {
    SourceProperties : [ priority ],
    TargetProperties : [ 'reasonControl' ]
  }
);

annotate service.STOs with actions {
  submit   @(Core.OperationAvailable: { $edmJson: { $Path: 'in/canSubmit' } });
  withdraw @(Core.OperationAvailable: { $edmJson: { $Path: 'in/canWithdraw' } });
  approve  @(Core.OperationAvailable: { $edmJson: { $Path: 'in/canApprove' } });
  reject   @(Core.OperationAvailable: { $edmJson: { $Path: 'in/canReject' } });
  cancel   @(Core.OperationAvailable: { $edmJson: { $Path: 'in/canCancel' } });
  complete @(Core.OperationAvailable: { $edmJson: { $Path: 'in/canComplete' } });
};

annotate service.STOs actions {
  reject   (reason   @Common.FieldControl: #Mandatory @title: 'Rejection Reason');
  cancel   (reason   @title: 'Cancellation Reason');
  complete (comments @title: 'Comments');
};

// ====================================================================
// List Report + Object Page
// ====================================================================
annotate service.STOs with @(
  Common.SemanticKey: [ stoNumber ],

  UI.HeaderInfo: {
    TypeName: 'Stock Transport Order', TypeNamePlural: 'Stock Transport Orders',
    Title: { Value: stoNumber }, Description: { Value: status }
  },

  UI.SelectionFields: [
    status, sourcePlant_code, destinationPlant_code, stoDate, requestedDeliveryDate, priority, createdBy
  ],

  UI.LineItem: [
    { Value: stoNumber,             ![@UI.Importance]: #High },
    { Value: stoDate },
    { Value: sourcePlant_code,      ![@UI.Importance]: #High },
    { Value: destinationPlant_code, ![@UI.Importance]: #High },
    { Value: requestedDeliveryDate },
    { Value: priority,  Criticality: priorityCriticality },
    { Value: status,    Criticality: statusCriticality, ![@UI.Importance]: #High },
    { Value: createdBy }
  ],

  // Quick-filter tabs with counts = dashboard KPIs (Total / Draft / Submitted / ...)
  UI.SelectionVariant #All       : { Text: 'All',       SelectOptions: [] },
  UI.SelectionVariant #Draft     : { Text: 'Draft',     SelectOptions: [{ PropertyName: status, Ranges: [{ Sign: #I, Option: #EQ, Low: 'Draft' }] }] },
  UI.SelectionVariant #Submitted : { Text: 'Submitted', SelectOptions: [{ PropertyName: status, Ranges: [{ Sign: #I, Option: #EQ, Low: 'Submitted' }] }] },
  UI.SelectionVariant #Approved  : { Text: 'Approved',  SelectOptions: [{ PropertyName: status, Ranges: [{ Sign: #I, Option: #EQ, Low: 'Approved' }] }] },
  UI.SelectionVariant #Rejected  : { Text: 'Rejected',  SelectOptions: [{ PropertyName: status, Ranges: [{ Sign: #I, Option: #EQ, Low: 'Rejected' }] }] },
  UI.SelectionVariant #Completed : { Text: 'Completed', SelectOptions: [{ PropertyName: status, Ranges: [{ Sign: #I, Option: #EQ, Low: 'Completed' }] }] },
  UI.SelectionVariant #Cancelled : { Text: 'Cancelled', SelectOptions: [{ PropertyName: status, Ranges: [{ Sign: #I, Option: #EQ, Low: 'Cancelled' }] }] },

  // Object page header buttons (visibility via Core.OperationAvailable above)
  UI.Identification: [
    { $Type: 'UI.DataFieldForAction', Action: 'StoreService.submit',   Label: 'Submit',   Criticality: #Positive },
    { $Type: 'UI.DataFieldForAction', Action: 'StoreService.withdraw', Label: 'Withdraw' },
    { $Type: 'UI.DataFieldForAction', Action: 'StoreService.approve',  Label: 'Approve',  Criticality: #Positive },
    { $Type: 'UI.DataFieldForAction', Action: 'StoreService.reject',   Label: 'Reject',   Criticality: #Negative },
    { $Type: 'UI.DataFieldForAction', Action: 'StoreService.complete', Label: 'Complete' },
    { $Type: 'UI.DataFieldForAction', Action: 'StoreService.cancel',   Label: 'Cancel',   Criticality: #Negative }
  ],

  UI.Facets: [
    { $Type: 'UI.CollectionFacet', ID: 'HeaderFacet', Label: 'STO Header', Facets: [
        { $Type: 'UI.ReferenceFacet', ID: 'General', Label: 'General', Target: '@UI.FieldGroup#General' },
        { $Type: 'UI.ReferenceFacet', ID: 'Admin',   Label: 'Administrative Data', Target: '@UI.FieldGroup#Admin' }
    ]},
    { $Type: 'UI.ReferenceFacet', ID: 'ItemsFacet',    Label: 'STO Items',            Target: 'items/@UI.LineItem' },
    { $Type: 'UI.ReferenceFacet', ID: 'HistoryFacet',  Label: 'Status History',       Target: 'history/@UI.LineItem' },
    { $Type: 'UI.ReferenceFacet', ID: 'ApprovalFacet', Label: 'Approval Information', Target: '@UI.FieldGroup#Approval' }
  ],

  UI.FieldGroup #General: { Data: [
    { Value: stoNumber }, { Value: stoDate },
    { Value: sourcePlant_code }, { Value: destinationPlant_code },
    { Value: requestedDeliveryDate }, { Value: priority },
    { Value: status, Criticality: statusCriticality },
    { Value: reason }, { Value: remarks }
  ]},
  UI.FieldGroup #Admin: { Data: [
    { Value: requestedBy }, { Value: createdAt }, { Value: createdBy }, { Value: modifiedAt }, { Value: modifiedBy }
  ]},
  UI.FieldGroup #Approval: { Data: [
    { Value: approvalLevel }, { Value: approvedBy }, { Value: approvedAt }, { Value: rejectionReason }
  ]}
);

annotate service.STOItems with @(
  Common.SemanticKey: [ itemNumber ],

  UI.HeaderInfo: {
    TypeName: 'STO Item', TypeNamePlural: 'STO Items',
    Title:       { Value: itemNumber },
    Description: { Value: materialDescription }
  },

  UI.LineItem: [
    { Value: itemNumber,          ![@UI.Importance]: #High },
    { Value: material_code,       ![@UI.Importance]: #High },
    { Value: materialDescription },
    { Value: quantity,            ![@UI.Importance]: #High },
    { Value: uom_code,            ![@UI.Importance]: #High },
    { Value: batch },
    { Value: remarks }
  ],

  UI.Identification: [
    { Value: itemNumber },
    { Value: material_code }
  ],

  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', ID: 'ItemDetailsFacet', Label: 'Item Details', Target: '@UI.FieldGroup#ItemDetails' }
  ],

  UI.FieldGroup #ItemDetails: { Data: [
    { Value: itemNumber },
    { Value: material_code },
    { Value: materialDescription },
    { Value: quantity },
    { Value: uom_code },
    { Value: batch },
    { Value: remarks }
  ]}
);

annotate service.STOStatusHistory with @(
  UI.LineItem: [
    { Value: oldStatus }, { Value: newStatus }, { Value: changedBy }, { Value: changedAt }, { Value: comments }
  ]
);
