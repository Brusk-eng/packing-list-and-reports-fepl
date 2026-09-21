frappe.ui.form.on('Packing List Formax', {
    validate: function(frm) {
        let total_items_qty = 0;
        (frm.doc.items || []).forEach(item => {
            total_items_qty += parseFloat(item.quantity || 0);
        });
        
        let qty_str = String(frm.doc.total_invoice_qty || "0");
        let cleaned_qty = parseFloat(qty_str.replace(/[^0-9.]/g, '')) || 0;
        
        if (Math.abs(total_items_qty - cleaned_qty) > 0.0001) {
            let display_qty = Number.isInteger(total_items_qty) ? total_items_qty + " Pcs" : total_items_qty.toFixed(2) + " Pcs";
            let display_target = qty_str.includes("Pcs") ? qty_str : qty_str + " Pcs";
            
            frappe.msgprint({
                title: __('Validation Error'),
                indicator: 'red',
                message: __('Total Item Lines Quantity ({0}) must be equal to Total Invoice Qty ({1}) in Sales Invoice before saving.', [display_qty, display_target])
            });
            frappe.validated = false;
        }
    },
    setup: function(frm) {
        // Set query for item_code to only show items from the selected Sales Invoice
        frm.set_query('item_code', 'items', function() {
            if (!frm.doc.sales_invoice) {
                return {
                    filters: {
                        'name': ['in', []]
                    }
                };
            }
            return {
                query: "packing_list_reports_fepl.packing.doctype.packing_list_formax.packing_list_formax.get_items_from_si",
                filters: {
                    'sales_invoice': frm.doc.sales_invoice
                }
            };
        });
    },
    refresh: function(frm) {
        if (frm.doc.docstatus === 1) {
            frm.add_custom_button(__('Print Stickers'), function() {
                frappe.call({
                    method: 'packing_list_reports_fepl.packing.doctype.packing_list_formax.packing_list_formax.get_print_html',
                    args: { docname: frm.doc.name, print_type: 'Stickers' },
                    callback: function(r) {
                        if (r.message) {
                            var w = window.open();
                            w.document.write(r.message);
                            w.document.close();
                        }
                    }
                });
            }, __('Print'));

            frm.add_custom_button(__('Print Labels'), function() {
                frappe.call({
                    method: 'packing_list_reports_fepl.packing.doctype.packing_list_formax.packing_list_formax.get_print_html',
                    args: { docname: frm.doc.name, print_type: 'Labels' },
                    callback: function(r) {
                        if (r.message) {
                            var w = window.open();
                            w.document.write(r.message);
                            w.document.close();
                        }
                    }
                });
            }, __('Print'));

            frm.add_custom_button(__('Print Stickers (15x50mm)'), function() {
                frappe.call({
                    method: 'packing_list_reports_fepl.packing.doctype.packing_list_formax.packing_list_formax.get_sticker_items_summary',
                    args: { docname: frm.doc.name },
                    freeze: true,
                    callback: function(r) {
                        if (r.message && r.message.length > 0) {
                            let items = r.message;
                            let rows_html = '';
                            items.forEach(function(item) {
                                rows_html += `
                                    <tr>
                                        <td><b>${item.item_name || item.item_code}</b><br><small class="text-muted">CPN: ${item.custom_cpn || 'N/A'}</small></td>
                                        <td class="text-center">${item.quantity}</td>
                                        <td class="text-center">${item.std_qty}</td>
                                        <td style="width: 130px;">
                                            <input type="number" min="0" step="1" class="form-control text-right sticker-qty-input" data-item-name="${item.name}" value="${item.num_stickers}">
                                        </td>
                                    </tr>
                                `;
                            });

                            let html = `
                                                                <div style="margin-bottom: 12px; background: #eef7fc; padding: 10px 14px; border-radius: 6px; border-left: 4px solid #2490ef;">
                                    <p style="font-size: 13px; margin: 0; color: #1e3a8a;">
                                        <b>TSC Print Tip:</b> In the browser print window, select <b>Layout: Landscape</b> and <b>Margins: None</b> to print horizontally on both labels.
                                    </p>
                                </div>
                                <div style="max-height: 320px; overflow-y: auto;">
                                    <table class="table table-bordered table-condensed" style="margin-bottom: 0;">
                                        <thead>
                                            <tr class="active">
                                                <th>Item / CPN</th>
                                                <th class="text-center">Total Qty</th>
                                                <th class="text-center">Std Pack</th>
                                                <th class="text-right">Stickers to Print</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${rows_html}
                                        </tbody>
                                    </table>
                                </div>
                            `;

                            let d = new frappe.ui.Dialog({
                                title: __('Print Stickers (15x50mm)'),
                                fields: [
                                    { fieldtype: 'HTML', fieldname: 'items_table', options: html }
                                ],
                                primary_action_label: __('Print'),
                                primary_action: function() {
                                    let custom_quantities = {};
                                    d.$wrapper.find('.sticker-qty-input').each(function() {
                                        let item_key = $(this).attr('data-item-name');
                                        let count = parseInt($(this).val()) || 0;
                                        custom_quantities[item_key] = count;
                                    });
                                    d.hide();

                                    frappe.call({
                                        method: 'packing_list_reports_fepl.packing.doctype.packing_list_formax.packing_list_formax.get_stickers_15x50_html',
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
                            frappe.msgprint(__('No items found in Packing List Formax.'));
                        }
                    }
                });
            }, __('Print'));

            frm.add_custom_button(__('Excel: Packing List'), function() {
                var url = frappe.urllib.get_full_url("/api/method/packing_list_reports_fepl.packing.doctype.packing_list_formax.packing_list_formax.download_excel?docname=" + frm.doc.name + "&export_type=Packing List");
                window.open(url, '_blank');
            }, __('Actions'));

            frm.add_custom_button(__('Excel: Stickers Grid'), function() {
                var url = frappe.urllib.get_full_url("/api/method/packing_list_reports_fepl.packing.doctype.packing_list_formax.packing_list_formax.download_excel?docname=" + frm.doc.name + "&export_type=Stickers");
                window.open(url, '_blank');
            }, __('Actions'));

            frm.add_custom_button(__('Excel: Labels Data'), function() {
                var url = frappe.urllib.get_full_url("/api/method/packing_list_reports_fepl.packing.doctype.packing_list_formax.packing_list_formax.download_excel?docname=" + frm.doc.name + "&export_type=Labels");
                window.open(url, '_blank');
            }, __('Actions'));
        }
    },
    sales_invoice: function(frm) {
        if (frm.doc.sales_invoice) {
            frappe.db.get_value('Sales Invoice', frm.doc.sales_invoice, ['customer_name', 'posting_date'], (r) => {
                if (r) {
                    frm.set_value('customer_name', r.customer_name);
                    frm.set_value('sales_invoice_date', r.posting_date);
                }
            });
            
            frappe.call({
                method: 'packing_list_reports_fepl.packing.doctype.packing_list_formax.packing_list_formax.get_non_freight_qty',
                args: { sales_invoice: frm.doc.sales_invoice },
                callback: function(r) {
                    if (r.message) {
                        frm.set_value('total_invoice_qty', r.message);
                    }
                }
            });
            
            if (frm.doc.items && frm.doc.items.length > 0) {
                frappe.confirm(__('Changing Sales Invoice will clear the items table. Continue?'), () => {
                    frm.clear_table('items');
                    frm.refresh_field('items');
                    frm.events.calculate_total_quantity(frm);
                });
            }
        } else {
            frm.set_value('customer_name', '');
            frm.set_value('sales_invoice_date', '');
            frm.set_value('total_invoice_qty', '0 Pcs');
            frm.set_value('total_boxes', 0);
            frm.clear_table('items');
            frm.refresh_field('items');
        }
    },
    calculate_total_quantity: function(frm) {
        // total_boxes equals number of UNIQUE boxes in Packing List Formax
        let unique_boxes = new Set();
        (frm.doc.items || []).forEach(item => {
            if (item.box_number) {
                unique_boxes.add(item.box_number);
            }
        });
        frm.set_value('total_boxes', unique_boxes.size);
        
        // Ensure total_invoice_qty is synced if missing
        if ((!frm.doc.total_invoice_qty || frm.doc.total_invoice_qty === '0' || frm.doc.total_invoice_qty === '0 Pcs') && frm.doc.sales_invoice) {
            frappe.call({
                method: 'packing_list_reports_fepl.packing.doctype.packing_list_formax.packing_list_formax.get_non_freight_qty',
                args: { sales_invoice: frm.doc.sales_invoice },
                callback: function(r) {
                    if (r.message) {
                        frm.set_value('total_invoice_qty', r.message);
                    }
                }
            });
        }
    }
});

frappe.ui.form.on('Packing List Formax Item', {
    box_number: function(frm, cdt, cdn) {
        frm.events.calculate_total_quantity(frm);
    },
    items_remove: function(frm, cdt, cdn) {
        frm.events.calculate_total_quantity(frm);
    },
    items_add: function(frm, cdt, cdn) {
        frm.events.calculate_total_quantity(frm);
    },
    item_code: function(frm, cdt, cdn) {
        var row = locals[cdt][cdn];
        if (row.item_code && frm.doc.sales_invoice) {
            frappe.call({
                method: "packing_list_reports_fepl.packing.doctype.packing_list_formax.packing_list_formax.get_si_item_details",
                args: {
                    sales_invoice: frm.doc.sales_invoice,
                    item_code: row.item_code
                },
                callback: function(r) {
                    if (r.message) {
                        frappe.model.set_value(cdt, cdn, 'item_name', r.message.item_name);
                        frappe.model.set_value(cdt, cdn, 'description', r.message.description);
                        frappe.model.set_value(cdt, cdn, 'quantity', r.message.qty);
                        frappe.model.set_value(cdt, cdn, 'custom_cpn', r.message.custom_cpn);
                    }
                }
            });
        }
    }
});
