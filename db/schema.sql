CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  company_name TEXT NOT NULL,
  pin_code TEXT,
  num_bookable_spaces INTEGER DEFAULT 0,
  num_parking_spaces INTEGER DEFAULT 0,
  num_av_rooms INTEGER DEFAULT 0,
  num_buildings INTEGER DEFAULT 1,
  num_floors INTEGER DEFAULT 0,
  include_digital_signage INTEGER DEFAULT 0,
  include_visitor_mgmt INTEGER DEFAULT 0,

  -- Calculated pricing (USD annual)
  bookable_spaces_total REAL DEFAULT 0,
  campus_parking_total REAL DEFAULT 0,
  digital_signage_total REAL DEFAULT 0,
  visitor_mgmt_total REAL DEFAULT 0,
  env_monitoring_total REAL DEFAULT 0,
  space_util_total REAL DEFAULT 0,
  av_control_total REAL DEFAULT 0,
  subtotal REAL DEFAULT 0,
  discount_pct REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  total_annual REAL DEFAULT 0,

  -- Setup fees
  setup_config REAL DEFAULT 6000,
  setup_maps REAL DEFAULT 0,
  setup_integration REAL DEFAULT 5000,
  setup_total REAL DEFAULT 0,

  -- Acceptance
  status TEXT DEFAULT 'pending',  -- pending, accepted, expired
  accepted_at TEXT,
  signature_name TEXT,
  signature_data TEXT,
  ip_address TEXT,
  early_bird_bonus INTEGER DEFAULT 0,  -- 1 if accepted within 72 hours

  -- Tracking
  view_count INTEGER DEFAULT 0,
  last_viewed_at TEXT,

  -- Xero integration
  xero_quote_id TEXT,
  xero_invoice_id TEXT,
  xero_final_invoice_id TEXT,

  -- Follow-up / sales
  follow_up_status TEXT,
  follow_up_notes TEXT,
  downsell_offer_pct REAL,
  downsell_sent_at TEXT,

  -- Bank / org details (cached from Xero at acceptance time)
  bank_account_name TEXT,
  bank_account_number TEXT,
  bank_currency_code TEXT,
  org_legal_name TEXT,
  org_tax_number TEXT,
  org_address TEXT,

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT DEFAULT (datetime('now', '+30 days')),
  invoice_number TEXT
);
