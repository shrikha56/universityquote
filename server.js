require('dotenv').config();
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');
const { xero, initializeXero, saveTokens, createXeroQuote, convertQuoteToInvoice, emailInvoice, getOrganisationDetails, getBankAccount, getInvoicePdf } = require('./xero-integration');
const { sendQuoteEmail, sendFollowUpEmail, sendDownsellEmail, testEmailConfig } = require('./email-service');

const app = express();
const PORT = process.env.PORT || 3000;

// Database setup — use DATA_DIR env var for production, fallback to ./db
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'db');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'university.db');
const db = new Database(dbPath);
db.pragma('journal_mode = DELETE');
const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf-8');
db.exec(schema);

// Migrate: add any missing columns to existing DBs
const allCols = {
  pin_code: 'TEXT',
  num_bookable_spaces: 'INTEGER DEFAULT 0',
  num_parking_spaces: 'INTEGER DEFAULT 0',
  num_av_rooms: 'INTEGER DEFAULT 0',
  num_floors: 'INTEGER DEFAULT 0',
  num_buildings: 'INTEGER DEFAULT 1',
  include_digital_signage: 'INTEGER DEFAULT 0',
  include_visitor_mgmt: 'INTEGER DEFAULT 0',
  bookable_spaces_total: 'REAL DEFAULT 0',
  campus_parking_total: 'REAL DEFAULT 0',
  digital_signage_total: 'REAL DEFAULT 0',
  visitor_mgmt_total: 'REAL DEFAULT 0',
  env_monitoring_total: 'REAL DEFAULT 0',
  space_util_total: 'REAL DEFAULT 0',
  av_control_total: 'REAL DEFAULT 0',
  subtotal: 'REAL DEFAULT 0',
  discount_pct: 'REAL DEFAULT 0',
  discount_amount: 'REAL DEFAULT 0',
  total_annual: 'REAL DEFAULT 0',
  setup_config: 'REAL DEFAULT 6000',
  setup_maps: 'REAL DEFAULT 0',
  setup_integration: 'REAL DEFAULT 5000',
  setup_total: 'REAL DEFAULT 0',
  status: "TEXT DEFAULT 'pending'",
  accepted_at: 'TEXT',
  signature_name: 'TEXT',
  signature_data: 'TEXT',
  ip_address: 'TEXT',
  early_bird_bonus: 'INTEGER DEFAULT 0',
  view_count: 'INTEGER DEFAULT 0',
  last_viewed_at: 'TEXT',
  xero_quote_id: 'TEXT',
  xero_invoice_id: 'TEXT',
  xero_final_invoice_id: 'TEXT',
  follow_up_status: 'TEXT',
  follow_up_notes: 'TEXT',
  downsell_offer_pct: 'REAL',
  downsell_sent_at: 'TEXT',
  bank_account_name: 'TEXT',
  bank_account_number: 'TEXT',
  bank_currency_code: 'TEXT',
  org_legal_name: 'TEXT',
  org_tax_number: 'TEXT',
  org_address: 'TEXT',
  invoice_number: 'TEXT',
};
const existingCols = db.prepare("PRAGMA table_info(quotes)").all().map(c => c.name);
for (const [col, type] of Object.entries(allCols)) {
  if (!existingCols.includes(col)) {
    db.exec(`ALTER TABLE quotes ADD COLUMN ${col} ${type}`);
    console.log(`Migrated: added column ${col}`);
  }
}

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== PRICING ENGINE =====
const PRICING = {
  bookable_spaces: { per: 'space',    usd: 120  },
  campus_parking:  { per: 'space',    usd: 36   },
  digital_signage: { per: 'building', usd: 1500 },
  visitor_mgmt:    { per: 'building', usd: 5000 },
  env_monitoring:  { per: 'floor',    usd: 2000 },
  space_util:      { per: 'floor',    usd: 2000 },
  av_control:      { per: 'room',     usd: 500  },
};

const SETUP = {
  config:      6000,
  map_per_map: 1000,
  integration: 5000,
};

function calculateQuote(data) {
  const bookableSpaces = parseInt(data.num_bookable_spaces) || 0;
  const parkingSpaces = parseInt(data.num_parking_spaces) || 0;
  const avRooms = parseInt(data.num_av_rooms) || 0;
  const floors = parseInt(data.num_floors) || 0;
  const buildings = parseInt(data.num_buildings) || 1;
  const includeDigitalSignage = data.include_digital_signage === '1' || data.include_digital_signage === 1;
  const includeVisitorMgmt = data.include_visitor_mgmt === '1' || data.include_visitor_mgmt === 1;

  const bookable_spaces_total = bookableSpaces * PRICING.bookable_spaces.usd;
  const campus_parking_total = parkingSpaces * PRICING.campus_parking.usd;
  const digital_signage_total = includeDigitalSignage ? (buildings * PRICING.digital_signage.usd) : 0;
  const visitor_mgmt_total = includeVisitorMgmt ? (buildings * PRICING.visitor_mgmt.usd) : 0;
  const env_monitoring_total = floors * PRICING.env_monitoring.usd;
  const space_util_total = floors * PRICING.space_util.usd;
  const av_control_total = avRooms * PRICING.av_control.usd;

  const subtotal = bookable_spaces_total + campus_parking_total + digital_signage_total +
    visitor_mgmt_total + env_monitoring_total + space_util_total + av_control_total;

  // Volume discount tiers
  let discount_pct = 0;
  if (subtotal >= 100000) discount_pct = 0.20;
  else if (subtotal >= 50000) discount_pct = 0.15;
  else if (subtotal >= 25000) discount_pct = 0.10;
  else if (subtotal >= 10000) discount_pct = 0.05;

  const discount_amount = subtotal * discount_pct;
  const total_annual = subtotal - discount_amount;

  // Setup fees
  const setup_maps = floors * SETUP.map_per_map;
  const setup_total = SETUP.config + setup_maps + SETUP.integration;

  return {
    bookable_spaces_total, campus_parking_total, digital_signage_total,
    visitor_mgmt_total, env_monitoring_total, space_util_total, av_control_total,
    subtotal, discount_pct, discount_amount, total_annual,
    setup_config: SETUP.config, setup_maps, setup_integration: SETUP.integration, setup_total,
  };
}

function generateSlug(companyName) {
  let base = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let slug = base;
  let counter = 1;
  while (db.prepare('SELECT id FROM quotes WHERE slug = ?').get(slug)) {
    slug = `${base}-${counter}`;
    counter++;
  }
  return slug;
}

function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const count = db.prepare("SELECT COUNT(*) as c FROM quotes WHERE invoice_number IS NOT NULL").get().c;
  return `POS-UQ-${year}-${String(count + 1).padStart(4, '0')}`;
}

// ===== INITIALIZATION =====

// Initialize Xero on startup
initializeXero().catch(err => {
  console.error('Failed to initialize Xero:', err.message);
});

// Test email configuration on startup
testEmailConfig();

// ===== HEALTH CHECK (for external cron pings to keep server awake) =====

app.get('/health', (req, res) => {
  const tokenSet = xero.readTokenSet();
  const hasToken = !!(tokenSet && tokenSet.access_token);
  const expiresAt = tokenSet?.expires_at ? new Date(tokenSet.expires_at * 1000).toISOString() : null;
  res.json({
    status: 'ok',
    xero_connected: hasToken,
    xero_token_expires: expiresAt,
    uptime: Math.floor(process.uptime()) + 's',
  });
});

// ===== XERO OAUTH ROUTES =====

// Connect to Xero (admin only - protect this route in production!)
app.get('/xero/connect', async (req, res) => {
  try {
    const consentUrl = await xero.buildConsentUrl();
    res.redirect(consentUrl);
  } catch (err) {
    res.status(500).send('Error initiating Xero OAuth: ' + err.message);
  }
});

// Xero OAuth callback
app.get('/xero/callback', async (req, res) => {
  try {
    const tokenSet = await xero.apiCallback(req.url);
    saveTokens(tokenSet);
    await xero.updateTenants();
    res.send('Successfully connected to Xero! You can close this window.');
  } catch (err) {
    res.status(500).send('Error completing Xero OAuth: ' + err.message);
  }
});

// ===== ADMIN ROUTES =====

// Admin dashboard - track pending/abandoned quotes
app.get('/admin/dashboard', (req, res) => {
  const now = new Date();

  const allQuotes = db.prepare(`
    SELECT *,
      julianday('now') - julianday(created_at) as days_old,
      julianday('now') - julianday(last_viewed_at) as days_since_view
    FROM quotes
    ORDER BY created_at DESC
  `).all();

  const stats = {
    pending: allQuotes.filter(q => q.status === 'pending').length,
    accepted: allQuotes.filter(q => q.status === 'accepted').length,
    expired: allQuotes.filter(q => q.status === 'pending' && new Date(q.expires_at) < now).length,
    hot: allQuotes.filter(q => q.status === 'pending' && q.view_count >= 3).length,
    abandoned: allQuotes.filter(q => q.status === 'pending' && q.view_count > 0 && q.days_since_view > 2).length,
    flagged: allQuotes.filter(q => q.follow_up_status === 'flagged').length,
  };

  res.render('admin-dashboard', { quotes: allQuotes, stats, now: new Date() });
});

// API: Update follow-up status
app.post('/admin/quotes/:slug/follow-up', (req, res) => {
  const { status, notes, downsell_pct } = req.body;

  db.prepare(`
    UPDATE quotes
    SET follow_up_status = ?, follow_up_notes = ?, downsell_offer_pct = ?
    WHERE slug = ?
  `).run(status || 'flagged', notes || '', parseFloat(downsell_pct) || 0, req.params.slug);

  res.json({ success: true });
});

// API: Send downsell offer
app.post('/admin/quotes/:slug/send-downsell', async (req, res) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE slug = ?').get(req.params.slug);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });

  const { discount_pct } = req.body;
  const discountPct = parseFloat(discount_pct) || 0;

  const emailSent = await sendDownsellEmail(quote, discountPct);

  if (emailSent) {
    db.prepare(`
      UPDATE quotes
      SET downsell_offer_pct = ?, downsell_sent_at = datetime('now'), follow_up_status = 'downsell_sent'
      WHERE slug = ?
    `).run(discountPct, req.params.slug);

    res.json({ success: true, message: 'Downsell offer sent' });
  } else {
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// API: Send follow-up reminder email
app.post('/admin/quotes/:slug/send-reminder', async (req, res) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE slug = ?').get(req.params.slug);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });

  const emailSent = await sendFollowUpEmail(quote);

  if (emailSent) {
    db.prepare(`
      UPDATE quotes
      SET follow_up_status = 'contacted'
      WHERE slug = ?
    `).run(req.params.slug);

    res.json({ success: true, message: 'Follow-up email sent' });
  } else {
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// ===== ROUTES =====

// Landing page - Quote configurator
app.get('/', (req, res) => {
  res.render('index', { PRICING, SETUP });
});

// Generate quote
app.post('/generate-quote', async (req, res) => {
  // Verify Cloudflare Turnstile (if token provided)
  const turnstileToken = req.body['cf-turnstile-response'];
  if (turnstileToken) {
    try {
      const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: process.env.TURNSTILE_SECRET_KEY,
          response: turnstileToken,
          remoteip: req.ip,
        }),
      });
      const turnstileData = await turnstileRes.json();
      if (!turnstileData.success) {
        return res.status(403).json({ error: 'Human verification failed. Please try again.' });
      }
    } catch (err) {
      console.error('Turnstile verification error:', err.message);
      // Allow through if Cloudflare is unreachable
    }
  } else {
    console.warn('Turnstile token missing — widget may not have loaded for this user');
  }

  const { contact_name, contact_email, company_name, pin_code,
    num_bookable_spaces, num_parking_spaces, num_av_rooms,
    num_floors, num_buildings, include_digital_signage, include_visitor_mgmt } = req.body;

  if (!contact_name || !contact_email || !company_name) {
    return res.status(400).json({ error: 'Name, email, and university name are required.' });
  }

  // Validate PIN if provided
  if (pin_code && (!/^\d{4}$/.test(pin_code))) {
    return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
  }

  const slug = generateSlug(company_name);
  const pricing = calculateQuote(req.body);

  const stmt = db.prepare(`
    INSERT INTO quotes (slug, contact_name, contact_email, company_name, pin_code,
      num_bookable_spaces, num_parking_spaces, num_av_rooms, num_floors, num_buildings,
      include_digital_signage, include_visitor_mgmt,
      bookable_spaces_total, campus_parking_total, digital_signage_total,
      visitor_mgmt_total, env_monitoring_total, space_util_total, av_control_total,
      subtotal, discount_pct, discount_amount, total_annual,
      setup_config, setup_maps, setup_integration, setup_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    slug, contact_name, contact_email, company_name, pin_code || null,
    parseInt(num_bookable_spaces)||0, parseInt(num_parking_spaces)||0,
    parseInt(num_av_rooms)||0, parseInt(num_floors)||0, parseInt(num_buildings)||1,
    include_digital_signage === '1' ? 1 : 0, include_visitor_mgmt === '1' ? 1 : 0,
    pricing.bookable_spaces_total, pricing.campus_parking_total, pricing.digital_signage_total,
    pricing.visitor_mgmt_total, pricing.env_monitoring_total, pricing.space_util_total,
    pricing.av_control_total,
    pricing.subtotal, pricing.discount_pct, pricing.discount_amount, pricing.total_annual,
    pricing.setup_config, pricing.setup_maps, pricing.setup_integration, pricing.setup_total
  );

  // Create quote in Xero and cache org/bank details (non-blocking for response)
  const quoteData = db.prepare('SELECT * FROM quotes WHERE slug = ?').get(slug);
  if (quoteData) {
    (async () => {
      try {
        const xeroQuoteId = await createXeroQuote(quoteData);
        console.log(`Xero quote created at generation: ${xeroQuoteId}`);

        let bankDetails = null;
        let orgDetails = null;
        try {
          bankDetails = await getBankAccount();
          orgDetails = await getOrganisationDetails();
        } catch (err) {
          console.error('Could not fetch Xero org/bank details:', err.message);
        }

        db.prepare(`
          UPDATE quotes SET xero_quote_id = ?,
            bank_account_name = ?, bank_account_number = ?, bank_currency_code = ?,
            org_legal_name = ?, org_tax_number = ?, org_address = ?
          WHERE slug = ?
        `).run(
          xeroQuoteId,
          bankDetails?.name || null, bankDetails?.bankAccountNumber || null, bankDetails?.currencyCode || null,
          orgDetails?.legalName || orgDetails?.name || null, orgDetails?.taxNumber || null,
          orgDetails?.addresses?.[0] ? JSON.stringify(orgDetails.addresses[0]) : null,
          slug
        );
      } catch (err) {
        console.error('Xero quote creation failed:', err.message);
      }
    })();

    // Send confirmation email (non-blocking)
    sendQuoteEmail(quoteData).catch(err => console.error('Quote email failed:', err.message));
  }

  res.json({ success: true, slug });
});

// Live price preview (AJAX)
app.post('/api/preview-price', (req, res) => {
  const pricing = calculateQuote(req.body);
  res.json(pricing);
});

// Client proposal page
app.get('/:slug', (req, res) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE slug = ?').get(req.params.slug);
  if (!quote) return res.status(404).render('404');

  // Check if PIN is required and not provided
  if (quote.pin_code && req.query.pin !== quote.pin_code) {
    return res.render('pin-entry', { slug: req.params.slug, error: req.query.error });
  }

  // Track view (only for pending quotes)
  if (quote.status === 'pending') {
    db.prepare(`
      UPDATE quotes
      SET view_count = view_count + 1, last_viewed_at = datetime('now')
      WHERE slug = ?
    `).run(req.params.slug);
  }

  res.render('proposal', { quote, PRICING }, (err, html) => {
    if (err) { console.error('Render error:', err); return res.status(500).send('Render error: ' + err.message); }
    res.send(html);
  });
});

// PIN verification endpoint
app.post('/:slug/verify-pin', (req, res) => {
  const quote = db.prepare('SELECT pin_code FROM quotes WHERE slug = ?').get(req.params.slug);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });

  const { pin } = req.body;
  if (quote.pin_code && pin === quote.pin_code) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Incorrect PIN' });
  }
});

// Accept quote
app.post('/:slug/accept', async (req, res) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE slug = ?').get(req.params.slug);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });
  if (quote.status === 'accepted') return res.status(400).json({ error: 'Quote already accepted' });

  const { signature_name, signature_data } = req.body;
  if (!signature_name || !signature_data) return res.status(400).json({ error: 'Signature required' });

  const invoice_number = generateInvoiceNumber();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // Check if accepted within 72 hours for early bird bonus
  const createdAt = new Date(quote.created_at);
  const now = new Date();
  const hoursDiff = (now - createdAt) / (1000 * 60 * 60);
  const earlyBirdBonus = hoursDiff <= 72 ? 1 : 0;

  let xeroQuoteId = quote.xero_quote_id || null;
  let xeroInvoiceId = null;
  let xeroFinalInvoiceId = null;

  try {
    if (!xeroQuoteId) {
      const quoteDataForXero = { ...quote, invoice_number, early_bird_bonus: earlyBirdBonus };
      xeroQuoteId = await createXeroQuote(quoteDataForXero);
      console.log(`Created Xero quote (late): ${xeroQuoteId}`);
    }

    const invoices = await convertQuoteToInvoice(xeroQuoteId, invoice_number, quote);
    xeroInvoiceId = invoices.depositInvoiceId;
    xeroFinalInvoiceId = invoices.finalInvoiceId;

    await emailInvoice(xeroInvoiceId, quote.contact_email);
    console.log(`Deposit invoice emailed to ${quote.contact_email}`);

    const pdfBuffer = await getInvoicePdf(xeroInvoiceId);
    if (pdfBuffer) {
      const { sendAcceptanceEmail } = require('./email-service');
      const updatedQuote = { ...quote, invoice_number: `${invoice_number}-M1`, early_bird_bonus: earlyBirdBonus };
      sendAcceptanceEmail(updatedQuote, pdfBuffer).catch(err => console.error('Acceptance email failed:', err.message));
    }

  } catch (err) {
    console.error('Xero integration error:', err.message);
  }

  let bankDetails = null;
  let orgDetails = null;
  try {
    bankDetails = await getBankAccount();
    orgDetails = await getOrganisationDetails();
  } catch (err) {
    console.error('Could not fetch Xero bank/org details at acceptance:', err.message);
  }

  db.prepare(`
    UPDATE quotes SET status = 'accepted', accepted_at = datetime('now'),
      signature_name = ?, signature_data = ?, ip_address = ?, invoice_number = ?, early_bird_bonus = ?,
      xero_quote_id = ?, xero_invoice_id = ?, xero_final_invoice_id = ?,
      bank_account_name = ?, bank_account_number = ?, bank_currency_code = ?,
      org_legal_name = ?, org_tax_number = ?, org_address = ?
    WHERE slug = ?
  `).run(
    signature_name, signature_data, ip, invoice_number, earlyBirdBonus, xeroQuoteId, xeroInvoiceId, xeroFinalInvoiceId || null,
    bankDetails?.name || null, bankDetails?.bankAccountNumber || null, bankDetails?.currencyCode || null,
    orgDetails?.legalName || orgDetails?.name || null, orgDetails?.taxNumber || null,
    orgDetails?.addresses?.[0] ? JSON.stringify(orgDetails.addresses[0]) : null,
    req.params.slug
  );

  res.json({ success: true, invoice_number, earlyBirdBonus });
});

// Invoice page
app.get('/:slug/invoice', async (req, res) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE slug = ?').get(req.params.slug);
  if (!quote) return res.status(404).render('404');
  if (quote.status !== 'accepted') return res.redirect(`/${req.params.slug}`);

  // Check if PIN is required and not provided
  if (quote.pin_code && req.query.pin !== quote.pin_code) {
    return res.render('pin-entry', { slug: req.params.slug, error: req.query.error });
  }

  let bankDetails = null;
  let orgDetails = null;

  if (quote.bank_account_name) {
    bankDetails = {
      name: quote.bank_account_name,
      bankAccountNumber: quote.bank_account_number,
      currencyCode: quote.bank_currency_code,
    };
  }

  if (quote.org_legal_name) {
    let parsedAddr = null;
    try { parsedAddr = quote.org_address ? JSON.parse(quote.org_address) : null; } catch (_) {}
    orgDetails = {
      legalName: quote.org_legal_name,
      taxNumber: quote.org_tax_number,
      addresses: parsedAddr ? [parsedAddr] : [],
    };
  }

  if (!bankDetails || !orgDetails) {
    try {
      if (!bankDetails) bankDetails = await getBankAccount();
      if (!orgDetails) orgDetails = await getOrganisationDetails();
    } catch (err) {
      console.error('Could not fetch Xero details for invoice:', err.message);
    }
  }

  res.render('invoice', { quote, PRICING, bankDetails, orgDetails });
});

app.listen(PORT, () => {
  console.log(`PlaceOS CampusOS running at http://localhost:${PORT}`);
});
