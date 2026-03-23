const serverless = require('serverless-http');
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const app = express();

// Database setup — use /tmp for Netlify (ephemeral)
const dataDir = '/tmp/db';
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'university.db');
const db = new Database(dbPath);
db.pragma('journal_mode = DELETE');

// Load schema
const schemaPath = path.join(__dirname, '../../db/schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema);

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../../views'));
app.use(express.static(path.join(__dirname, '../../public')));
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

  let discount_pct = 0;
  if (subtotal >= 100000) discount_pct = 0.20;
  else if (subtotal >= 50000) discount_pct = 0.15;
  else if (subtotal >= 25000) discount_pct = 0.10;
  else if (subtotal >= 10000) discount_pct = 0.05;

  const discount_amount = subtotal * discount_pct;
  const total_annual = subtotal - discount_amount;

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

// ===== ROUTES =====

app.get('/', (req, res) => {
  res.render('index', { PRICING, SETUP });
});

app.post('/generate-quote', (req, res) => {
  const { contact_name, contact_email, company_name,
    num_bookable_spaces, num_parking_spaces, num_av_rooms,
    num_floors, num_buildings, include_digital_signage, include_visitor_mgmt } = req.body;

  if (!contact_name || !contact_email || !company_name) {
    return res.status(400).json({ error: 'Name, email, and university name are required.' });
  }

  const slug = generateSlug(company_name);
  const pricing = calculateQuote(req.body);

  const stmt = db.prepare(`
    INSERT INTO quotes (slug, contact_name, contact_email, company_name,
      num_bookable_spaces, num_parking_spaces, num_av_rooms, num_floors, num_buildings,
      include_digital_signage, include_visitor_mgmt,
      bookable_spaces_total, campus_parking_total, digital_signage_total,
      visitor_mgmt_total, env_monitoring_total, space_util_total, av_control_total,
      subtotal, discount_pct, discount_amount, total_annual,
      setup_config, setup_maps, setup_integration, setup_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    slug, contact_name, contact_email, company_name,
    parseInt(num_bookable_spaces)||0, parseInt(num_parking_spaces)||0,
    parseInt(num_av_rooms)||0, parseInt(num_floors)||0, parseInt(num_buildings)||1,
    include_digital_signage === '1' ? 1 : 0, include_visitor_mgmt === '1' ? 1 : 0,
    pricing.bookable_spaces_total, pricing.campus_parking_total, pricing.digital_signage_total,
    pricing.visitor_mgmt_total, pricing.env_monitoring_total, pricing.space_util_total,
    pricing.av_control_total,
    pricing.subtotal, pricing.discount_pct, pricing.discount_amount, pricing.total_annual,
    pricing.setup_config, pricing.setup_maps, pricing.setup_integration, pricing.setup_total
  );

  res.json({ success: true, slug });
});

app.post('/api/preview-price', (req, res) => {
  const pricing = calculateQuote(req.body);
  res.json(pricing);
});

app.get('/:slug', (req, res) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE slug = ?').get(req.params.slug);
  if (!quote) return res.status(404).render('404');
  res.render('proposal', { quote, PRICING }, (err, html) => {
    if (err) { console.error('Render error:', err); return res.status(500).send('Render error: ' + err.message); }
    res.send(html);
  });
});

app.post('/:slug/accept', (req, res) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE slug = ?').get(req.params.slug);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });
  if (quote.status === 'accepted') return res.status(400).json({ error: 'Quote already accepted' });

  const { signature_name, signature_data } = req.body;
  if (!signature_name || !signature_data) return res.status(400).json({ error: 'Signature required' });

  const invoice_number = generateInvoiceNumber();
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  db.prepare(`
    UPDATE quotes SET status = 'accepted', accepted_at = datetime('now'),
      signature_name = ?, signature_data = ?, ip_address = ?, invoice_number = ?
    WHERE slug = ?
  `).run(signature_name, signature_data, ip, invoice_number, req.params.slug);

  res.json({ success: true, invoice_number });
});

app.get('/:slug/invoice', (req, res) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE slug = ?').get(req.params.slug);
  if (!quote) return res.status(404).render('404');
  if (quote.status !== 'accepted') return res.redirect(`/${req.params.slug}`);
  res.render('invoice', { quote, PRICING });
});

module.exports.handler = serverless(app);
