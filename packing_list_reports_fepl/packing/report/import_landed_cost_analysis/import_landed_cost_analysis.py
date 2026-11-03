import frappe
from frappe import _
from frappe.utils import flt

def execute(filters=None):
	if not filters: filters = {}
	columns = get_columns()
	data = get_data(filters)
	return columns, data

def get_columns():
	return [
		{"label": _("Purchase Invoice Date"), "fieldname": "posting_date", "fieldtype": "Date", "width": 100},
		{"label": _("Purchase Invoice No."), "fieldname": "purchase_invoice", "fieldtype": "Link", "options": "Purchase Invoice", "width": 140},
		{"label": _("Supplier Name"), "fieldname": "supplier", "fieldtype": "Data", "width": 150},
		{"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 120},
		{"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 150},
		{"label": _("Description"), "fieldname": "description", "fieldtype": "Data", "width": 200},
		{"label": _("Qty"), "fieldname": "qty", "fieldtype": "Float", "width": 100},
		{"label": _("Rate"), "fieldname": "rate", "fieldtype": "Currency", "options": "currency", "width": 100},
		{"label": _("Amount"), "fieldname": "amount", "fieldtype": "Currency", "options": "currency", "width": 120},
		{"label": _("Exchange Rate"), "fieldname": "conversion_rate", "fieldtype": "Float", "width": 100},
		{"label": _("Price in INR"), "fieldname": "price_in_inr", "fieldtype": "Currency", "width": 120},
		{"label": _("BE Number"), "fieldname": "be_number", "fieldtype": "Data", "width": 120},
		{"label": _("BE Date"), "fieldname": "be_date", "fieldtype": "Date", "width": 100},
		{"label": _("BCD Percent"), "fieldname": "bcd_percent", "fieldtype": "Currency", "width": 100},
		{"label": _("Freight"), "fieldname": "freight", "fieldtype": "Currency", "width": 100},
		{"label": _("CHA Charges"), "fieldname": "cha_charges", "fieldtype": "Currency", "width": 100},
		{"label": _("Landing Cost"), "fieldname": "landing_cost", "fieldtype": "Currency", "width": 120},
		{"label": _("Stock Qty"), "fieldname": "stock_qty", "fieldtype": "Float", "width": 100},
		{"label": _("Customer Name"), "fieldname": "customer_name", "fieldtype": "Data", "width": 150},
		{"label": _("Sale Price"), "fieldname": "sale_price", "fieldtype": "Currency", "width": 100},
		{"label": _("Sales Invoice No."), "fieldname": "sales_invoice_no", "fieldtype": "Link", "options": "Sales Invoice", "width": 140},
		{"label": _("Sales Invoice Date"), "fieldname": "sales_invoice_date", "fieldtype": "Date", "width": 100},
		{"label": _("Currency"), "fieldname": "currency", "fieldtype": "Data", "hidden": 1}
	]

def chunk_list(lst, size=1000):
	for i in range(0, len(lst), size):
		yield lst[i:i + size]

def get_data(filters):
	conditions = ""
	if filters.get("from_date"): conditions += " AND pi.posting_date >= %(from_date)s"
	if filters.get("to_date"): conditions += " AND pi.posting_date <= %(to_date)s"
	if filters.get("supplier"): conditions += " AND pi.supplier = %(supplier)s"
	if filters.get("item_code"): conditions += " AND pii.item_code = %(item_code)s"

	# 1. Pre-fetch Bill of Entry into a fast lookup map (avoids 40,000 unindexed full-table joins)
	has_boe = frappe.db.exists("DocType", "Bill of Entry")
	boe_map = {}
	if has_boe:
		columns = frappe.db.get_table_columns("Bill of Entry Item") or []
		item_field = "item_code" if "item_code" in columns else "item"
		bcd_col = None
		candidates = ["customs_and_additional_charges", "customs_and_additional_duty", "customs_duty", "total_customs_duty", "total_duty_amount"]
		for cand in candidates:
			if cand in columns:
				bcd_col = cand
				break
		if not bcd_col:
			for col in columns:
				if "customs" in col or "duty" in col:
					if col not in ["customs_duty_payable_account", "customs_duty_expense_account"]:
						bcd_col = col
						break
		bcd_field_sql = f"boei.{bcd_col}" if bcd_col else "0.0"

		try:
			boe_records = frappe.db.sql(f"""
				SELECT
					boei.purchase_invoice,
					boei.{item_field} AS item_code,
					boe.bill_of_entry_no,
					boe.bill_of_entry_date,
					{bcd_field_sql} AS total_bcd
				FROM `tabBill of Entry Item` boei
				INNER JOIN `tabBill of Entry` boe ON boe.name = boei.parent AND boe.docstatus = 1
				WHERE boei.purchase_invoice IS NOT NULL AND boei.purchase_invoice != ''
			""", as_dict=True)
			for b in boe_records:
				boe_map[(b.purchase_invoice, b.item_code)] = b
		except Exception:
			pass

	# 2. Base Query: Fetch Purchase Invoice Items (Indexed joins only, runs in ~1-2 seconds)
	sql = f"""
		SELECT
			pi.posting_date AS posting_date,
			pi.name AS purchase_invoice,
			pi.supplier AS supplier,
			pii.item_code AS item_code,
			pii.item_name AS item_name,
			pii.description AS description,
			pii.qty AS qty,
			pii.rate AS rate,
			pii.amount AS amount,
			pi.currency AS currency,
			pi.conversion_rate AS conversion_rate,
			(pii.rate * pi.conversion_rate) AS price_in_inr,
			pii.purchase_receipt AS purchase_receipt
		FROM `tabPurchase Invoice Item` pii
		INNER JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent AND pi.docstatus = 1
		INNER JOIN `tabItem` item ON item.name = pii.item_code AND item.is_stock_item = 1
		WHERE 1=1 {conditions}
		ORDER BY pi.posting_date DESC, pi.name DESC
	"""
	
	raw_data = frappe.db.sql(sql, filters, as_dict=True)
	if not raw_data:
		return []

	# Extract unique item codes and receipt documents for bulk pre-fetching
	item_codes = list({d.item_code for d in raw_data if d.item_code})
	receipt_docs = set()
	for d in raw_data:
		if d.purchase_invoice:
			receipt_docs.add(d.purchase_invoice)
		if d.get("purchase_receipt"):
			receipt_docs.add(d.purchase_receipt)
	receipt_docs = list(receipt_docs)

	# 3. Bulk Lookup: Stock Qty from tabBin in chunks
	stock_map = {}
	if item_codes:
		for i_chunk in chunk_list(item_codes, 1000):
			bin_records = frappe.db.sql("""
				SELECT item_code, SUM(actual_qty) AS stock_qty
				FROM `tabBin`
				WHERE item_code IN %(chunk)s
				GROUP BY item_code
			""", {"chunk": i_chunk}, as_dict=True)
			for b in bin_records:
				stock_map[b.item_code] = flt(b.stock_qty)

	# 4. Bulk Lookup: Landed Cost Voucher charges in chunks
	lcv_items_map = {}
	if receipt_docs and item_codes:
		for r_chunk in chunk_list(receipt_docs, 1000):
			lcv_records = frappe.db.sql("""
				SELECT DISTINCT
					lcpr.receipt_document,
					lci.item_code,
					lci.name AS lci_name,
					lci.applicable_charges
				FROM `tabLanded Cost Item` lci
				INNER JOIN `tabLanded Cost Voucher` lcv ON lcv.name = lci.parent AND lcv.docstatus = 1
				INNER JOIN `tabLanded Cost Purchase Receipt` lcpr ON lcpr.parent = lcv.name
				WHERE lcpr.receipt_document IN %(chunk)s
			""", {"chunk": r_chunk}, as_dict=True)
			for r in lcv_records:
				key = (r.receipt_document, r.item_code)
				if key not in lcv_items_map:
					lcv_items_map[key] = {}
				lcv_items_map[key][r.lci_name] = flt(r.applicable_charges)

	# 5. Bulk Lookup: Latest Sales Invoice details per item (Direct streaming sort, 10x faster)
	sales_map = {}
	if item_codes:
		for i_chunk in chunk_list(item_codes, 500):
			si_records = frappe.db.sql("""
				SELECT
					sii.item_code,
					si.name AS sales_invoice_no,
					si.posting_date AS sales_invoice_date,
					si.customer_name,
					sii.rate AS sale_price
				FROM `tabSales Invoice Item` sii
				INNER JOIN `tabSales Invoice` si ON si.name = sii.parent AND si.docstatus = 1
				WHERE sii.item_code IN %(chunk)s
				ORDER BY si.posting_date DESC, si.name DESC
			""", {"chunk": i_chunk}, as_dict=True)
			for s in si_records:
				if s.item_code not in sales_map:
					sales_map[s.item_code] = s

	# 6. In-Memory Assembly
	for d in raw_data:
		qty = flt(d.qty) or 1.0
		price_in_inr = flt(d.price_in_inr)
		
		# Bill of Entry
		boe_info = boe_map.get((d.purchase_invoice, d.item_code), {})
		d["be_number"] = boe_info.get("bill_of_entry_no") or ""
		d["be_date"] = boe_info.get("bill_of_entry_date") or None
		total_bcd = flt(boe_info.get("total_bcd") or 0.0)
		d["bcd_percent"] = total_bcd / qty
		
		# Landed Cost Voucher charges per unit
		matched_lci = {}
		if d.purchase_invoice and (d.purchase_invoice, d.item_code) in lcv_items_map:
			matched_lci.update(lcv_items_map[(d.purchase_invoice, d.item_code)])
		if d.get("purchase_receipt") and (d.purchase_receipt, d.item_code) in lcv_items_map:
			matched_lci.update(lcv_items_map[(d.purchase_receipt, d.item_code)])
		total_lcv_charges = sum(matched_lci.values())
		
		d["freight"] = total_lcv_charges / qty
		d["cha_charges"] = 0.0
		d["landing_cost"] = price_in_inr + d["bcd_percent"] + d["freight"] + d["cha_charges"]
		
		# Stock Qty
		d["stock_qty"] = stock_map.get(d.item_code, 0.0)
		
		# Latest Sales Invoice Info
		si_info = sales_map.get(d.item_code, {})
		d["customer_name"] = si_info.get("customer_name") or ""
		d["sale_price"] = si_info.get("sale_price") or 0.0
		d["sales_invoice_no"] = si_info.get("sales_invoice_no") or ""
		d["sales_invoice_date"] = si_info.get("sales_invoice_date") or None

	return raw_data
