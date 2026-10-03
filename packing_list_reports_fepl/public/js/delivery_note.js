frappe.ui.form.on('Delivery Note', {
	refresh: function(frm) {
		if (frm.doc.items && frm.doc.items.length > 0) {
			frm.add_custom_button(__('Mat.-Label (50x75mm)'), function() {
				frappe.call({
					method: 'packing_list_reports_fepl.packing.delivery_note_label.get_dn_label_items',
					args: { docname: frm.doc.name },
					freeze: true,
					callback: function(r) {
						if (r.message && r.message.length > 0) {
							let items = r.message;
							let rows_html = '';
							items.forEach(function(item) {
								rows_html += `
									<tr>
										<td><b>${item.item_name || item.item_code}</b><br><small class="text-muted">CPN: ${item.custom_cpn || 'N/A'} | Pkg ID: ${item.custom_package_id || 'N/A'}</small></td>
										<td class="text-center">${item.quantity}</td>
										<td class="text-center">${item.std_qty}</td>
										<td style="width: 120px;">
											<input type="number" min="0" step="1" class="form-control text-right dn-label-qty-input" data-item-name="${item.name}" value="${item.num_labels}">
										</td>
									</tr>
								`;
							});

							let html = `
								<div style="margin-bottom: 12px; background: #eef7fc; padding: 10px 14px; border-radius: 6px; border-left: 4px solid #2490ef;">
									<p style="font-size: 13px; margin: 0; color: #1e3a8a;">
										<b>TSC Printer Tip:</b> Ensure Paper Size is set to <b>75mm x 50mm</b>, <b>Layout: Portrait</b>, and <b>Margins: None</b>.
									</p>
								</div>
								<div style="max-height: 320px; overflow-y: auto;">
									<table class="table table-bordered table-condensed" style="margin-bottom: 0;">
										<thead>
											<tr class="active">
												<th>Item / Details</th>
												<th class="text-center">Total Qty</th>
												<th class="text-center">SPQ</th>
												<th class="text-right">Labels to Print</th>
											</tr>
										</thead>
										<tbody>
											${rows_html}
										</tbody>
									</table>
								</div>
							`;

							let d = new frappe.ui.Dialog({
								title: __('Print Mat.-Label (50x75mm)'),
								fields: [
									{ fieldtype: 'HTML', fieldname: 'items_table', options: html }
								],
								primary_action_label: __('Print'),
								primary_action: function() {
									let custom_quantities = {};
									d.$wrapper.find('.dn-label-qty-input').each(function() {
										let item_key = $(this).attr('data-item-name');
										let count = parseInt($(this).val()) || 0;
										custom_quantities[item_key] = count;
									});
									d.hide();

									frappe.call({
										method: 'packing_list_reports_fepl.packing.delivery_note_label.get_mat_label_html',
										args: {
											docname: frm.doc.name,
											custom_quantities: JSON.stringify(custom_quantities)
										},
										freeze: true,
										callback: function(res) {
											if (res.message) {
												var w = window.open();
												w.document.write(res.message);
												w.document.close();
											}
										}
									});
								},
								secondary_action_label: __('Cancel'),
								secondary_action: function() {
									d.hide();
								}
							});
							d.show();
						} else {
							frappe.msgprint(__('No items found in Delivery Note.'));
						}
					}
				});
			}, __('Print'));
		}
		if (frm.doc.docstatus === 0 && frm.doc.items && frm.doc.items.length > 0) {
			frm.add_custom_button(__('Fetch Allocation'), function() {
				frm.events.fetch_allocation(frm);
			}, __('Actions'));
		}

		if (frm.doc.docstatus === 0) {
			frappe.db.get_single_value('Packing List Settings', 'enable_get_specific_items_dn')
				.then(enabled => {
					if (enabled) {
						frm.add_custom_button(__('Get Specific Items'), function() {
							if (!frm.doc.customer) {
								frappe.msgprint({
									title: __('Customer Selection Required'),
									indicator: 'red',
									message: __('Please select a Customer first.')
								});
								return;
							}
							let customer = frm.doc.customer;
							let main_dialog = new frappe.ui.Dialog({
								title: __('Filter Items from Sales Order'),
								size: 'large',
								fields: [
									{
										fieldname: 'sales_order',
										label: __('Sales Order'),
										fieldtype: 'Link',
										options: 'Sales Order',
										get_query: () => {
											return {
												filters: {
													customer: customer,
													docstatus: 1,
													per_delivered: ['<', 100]
												}
											};
										},
										onchange: () => fetch_items()
									},
									{
										fieldname: 'item_code',
										label: __('Item Code'),
										fieldtype: 'Link',
										options: 'Item',
										onchange: () => fetch_items()
									},
									{
										fieldname: 'item_name',
										label: __('Item Name'),
										fieldtype: 'Data',
										onchange: () => fetch_items()
									},
									{
										fieldname: 'description',
										label: __('Description'),
										fieldtype: 'Data',
										onchange: () => fetch_items()
									},
									{
										fieldname: 'items_grid',
										label: __('Items'),
										fieldtype: 'Table',
										cannot_add_rows: true,
										cannot_delete_rows: true,
										in_place_edit: false,
										data: [],
										fields: [
											{
												fieldname: 'item_code',
												label: __('Item Code'),
												fieldtype: 'Read Only',
												in_list_view: 1,
												columns: 2
											},
											{
												fieldname: 'item_name',
												label: __('Item Name'),
												fieldtype: 'Read Only',
												in_list_view: 1,
												columns: 2
											},
											{
												fieldname: 'description',
												label: __('Description'),
												fieldtype: 'Read Only',
												in_list_view: 1,
												columns: 3
											},
											{
												fieldname: 'qty_to_deliver',
												label: __('Qty to Deliver'),
												fieldtype: 'Float',
												in_list_view: 1,
												columns: 2
											},
											// Hidden Fields
											{
												fieldname: 'delivered_qty',
												label: __('Delivered Qty'),
												fieldtype: 'Float',
												in_list_view: 0,
												hidden: 1
											},
											{
												fieldname: 'uom',
												label: __('UOM'),
												fieldtype: 'Read Only',
												in_list_view: 0,
												hidden: 1
											},
											{
												fieldname: 'warehouse',
												label: __('Warehouse'),
												fieldtype: 'Read Only',
												in_list_view: 0,
												hidden: 1
											},
											{
												fieldname: 'rate',
												label: __('Rate'),
												fieldtype: 'Read Only',
												in_list_view: 0,
												hidden: 1
											},
											{
												fieldname: 'sales_order',
												label: __('Sales Order'),
												fieldtype: 'Read Only',
												hidden: 1
											},
											{
												fieldname: 'so_detail',
												label: __('SO Detail'),
												fieldtype: 'Read Only',
												hidden: 1
											}
										]
									}
								],
								primary_action_label: __('Add Selected Items'),
								primary_action: function(values) {
									let selected_items = main_dialog.fields_dict.items_grid.df.data.filter(item => item.__checked);
									if (!selected_items.length) {
										frappe.msgprint(__('Please select at least one item.'));
										return;
									}

									// Clean up the first empty row if it is blank to prevent an unwanted empty first row
									let items = frm.doc.items || [];
									if (items.length === 1 && !items[0].item_code) {
										frm.clear_table('items');
									}

									selected_items.forEach(item => {
										let row = frm.add_child('items');
										row.item_code = item.item_code;
										row.item_name = item.item_name;
										row.description = item.description;
										row.qty = item.qty_to_deliver;
										row.uom = item.uom;
										row.warehouse = item.warehouse;
										row.rate = item.rate;
										row.against_sales_order = item.sales_order;
										row.so_detail = item.so_detail;
									});
									frm.refresh_field('items');
									frm.refresh();
									main_dialog.hide();
								}
							});

							const fetch_items = () => {
								let so = main_dialog.get_value('sales_order');
								let ic = main_dialog.get_value('item_code');
								let iname = main_dialog.get_value('item_name');
								let desc = main_dialog.get_value('description');

								if (!so && !ic && !iname && !desc) {
									main_dialog.fields_dict.items_grid.df.data = [];
									main_dialog.fields_dict.items_grid.refresh();
									return;
								}

								frappe.call({
									method: 'packing_list_reports_fepl.packing.doctype.packing_list_settings.packing_list_settings.get_so_items',
									args: {
										customer: customer,
										sales_order: so,
										item_code: ic,
										item_name: iname,
										description: desc
									},
									callback: function(r) {
										if (r.message) {
											main_dialog.fields_dict.items_grid.df.data = r.message;
											main_dialog.fields_dict.items_grid.refresh();
										}
									}
								});
							};

							fetch_items();
							main_dialog.show();
						}, __('Get Items From'));
					}
				});
		}
	},
	fetch_allocation: function(frm) {
		let items_to_check = frm.doc.items.map(i => i.item_code);
		let sales_orders = frm.doc.items.map(i => i.against_sales_order).filter(so => so);

		if (sales_orders.length === 0) {
			frappe.msgprint(__('This Delivery Note is not linked to any Sales Order.'));
			return;
		}

		frappe.call({
			method: "packing_list_reports_fepl.packing.doctype.item_allocation_sheet.item_allocation_sheet.get_allocation_for_dn",
			args: {
				sales_orders: sales_orders,
				items: items_to_check
			},
			callback: function(r) {
				if (r.message) {
					let allocations = r.message;
					let updated = false;

					frm.doc.items.forEach(item => {
						let key = item.against_sales_order + "|" + item.item_code;
						if (allocations[key]) {
							frappe.model.set_value(item.doctype, item.name, 'qty', allocations[key]);
							updated = true;
						}
					});

					if (updated) {
						frm.refresh_field('items');
						frappe.show_alert({message: __('Quantities updated based on Allocation Sheet'), color: 'green'});
					} else {
						frappe.msgprint(__('No matching allocations found for these items/orders.'));
					}
				}
			}
		});
	}
});
