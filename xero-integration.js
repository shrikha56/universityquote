require('dotenv').config();
const { XeroClient } = require('xero-node');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Token persistence path — use DATA_DIR env var for production, fallback to ./db
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'db');
const TOKEN_PATH = path.join(dataDir, 'xero-tokens.json');

// Initialize the Xero client
const xero = new XeroClient({
  clientId: process.env.XERO_CLIENT_ID,
  clientSecret: process.env.XERO_CLIENT_SECRET,
  redirectUris: [process.env.XERO_REDIRECT_URI || 'http://localhost:3000/xero/callback'],
  scopes: [
    'openid',
    'profile',
    'email',
    'offline_access',
    'accounting.invoices',
    'accounting.contacts',
    'accounting.settings',
  ],
});

// ===== TOKEN MANAGEMENT =====

function saveTokens(tokenSet) {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenSet, null, 2));
    console.log('Xero tokens saved successfully.');
  } catch (err) {
    console.error('Failed to save Xero tokens:', err.message);
  }
}

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const data = fs.readFileSync(TOKEN_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load Xero tokens:', err.message);
  }
  return null;
}

async function initializeXero() {
  await xero.initialize();

  const savedTokens = loadTokens();
  if (savedTokens) {
    xero.setTokenSet(savedTokens);

    try {
      if (savedTokens.expires_at && Date.now() / 1000 > savedTokens.expires_at - 120) {
        console.log('Xero token expired or expiring soon, refreshing...');
        const newTokenSet = await xero.refreshToken();
        saveTokens(newTokenSet);
      }
      await xero.updateTenants();
      console.log('Xero initialized with saved tokens. Tenant:', xero.tenants?.[0]?.tenantName ?? 'none');
    } catch (err) {
      console.error('Failed to refresh Xero token on startup:', err.message);
      console.log('Visit /xero/connect to re-authenticate.');
    }
  } else {
    console.log('No Xero tokens found. Visit /xero/connect to authenticate.');
  }

  // Cron: refresh access token every 20 minutes
  cron.schedule('*/20 * * * *', async () => {
    try {
      let tokenSet = xero.readTokenSet();
      if (!tokenSet || !tokenSet.refresh_token) {
        const saved = loadTokens();
        if (!saved || !saved.refresh_token) return;
        xero.setTokenSet(saved);
        tokenSet = saved;
      }
      const newTokenSet = await xero.refreshToken();
      saveTokens(newTokenSet);
      await xero.updateTenants();
      console.log(`[CRON] Xero token refreshed at ${new Date().toISOString()}`);
    } catch (err) {
      console.error('[CRON] Xero token refresh failed:', err.message);
    }
  });

  // Cron: daily keep-alive at 3am UTC
  cron.schedule('0 3 * * *', async () => {
    try {
      let tokenSet = xero.readTokenSet();
      if (!tokenSet || !tokenSet.refresh_token) {
        const saved = loadTokens();
        if (!saved || !saved.refresh_token) {
          console.warn('[CRON-DAILY] No refresh token available. Re-auth needed via /xero/connect.');
          return;
        }
        xero.setTokenSet(saved);
      }
      const newTokenSet = await xero.refreshToken();
      saveTokens(newTokenSet);
      await xero.updateTenants();
      console.log(`[CRON-DAILY] Xero daily keep-alive refresh at ${new Date().toISOString()}`);
    } catch (err) {
      console.error('[CRON-DAILY] Xero daily refresh failed:', err.message);
    }
  });

  console.log('Xero cron jobs scheduled: token refresh every 20min, daily keep-alive at 3am UTC.');
}

// Helper: ensure we have a valid token before API calls
async function ensureToken() {
  let tokenSet = xero.readTokenSet();
  if (!tokenSet || !tokenSet.access_token) {
    const saved = loadTokens();
    if (!saved || !saved.refresh_token) {
      throw new Error('Xero not authenticated. Visit /xero/connect first.');
    }
    xero.setTokenSet(saved);
    tokenSet = saved;
  }
  if (tokenSet.expires_at && Date.now() / 1000 > tokenSet.expires_at - 120) {
    const newTokenSet = await xero.refreshToken();
    saveTokens(newTokenSet);
    await xero.updateTenants();
  }
}

function getTenantId() {
  if (!xero.tenants || xero.tenants.length === 0) {
    throw new Error('No Xero tenant available. Re-authenticate via /xero/connect.');
  }
  return xero.tenants[0].tenantId;
}

// ===== CONTACT MANAGEMENT =====

async function findOrCreateContact(quote) {
  await ensureToken();
  const tenantId = getTenantId();

  const where = `EmailAddress=="${quote.contact_email}"`;
  const existingContacts = await xero.accountingApi.getContacts(tenantId, undefined, where);

  if (existingContacts.body.contacts && existingContacts.body.contacts.length > 0) {
    return existingContacts.body.contacts[0].contactID;
  }

  const contact = {
    name: quote.company_name,
    firstName: quote.contact_name.split(' ')[0],
    lastName: quote.contact_name.split(' ').slice(1).join(' ') || '',
    emailAddress: quote.contact_email,
  };

  const result = await xero.accountingApi.createContacts(tenantId, { contacts: [contact] });
  return result.body.contacts[0].contactID;
}

// ===== LINE ITEMS BUILDER =====

function buildLineItems(quote) {
  const lineItems = [];

  // Annual subscription line items
  if (quote.bookable_spaces_total > 0) {
    lineItems.push({
      description: `Bookable Spaces - ${quote.num_bookable_spaces} spaces @ $120/space/year`,
      quantity: 1,
      unitAmount: quote.bookable_spaces_total,
      accountCode: '200',
      taxType: 'OUTPUT',
    });
  }

  if (quote.campus_parking_total > 0) {
    lineItems.push({
      description: `Campus Parking - ${quote.num_parking_spaces} spaces @ $36/space/year`,
      quantity: 1,
      unitAmount: quote.campus_parking_total,
      accountCode: '200',
      taxType: 'OUTPUT',
    });
  }

  if (quote.digital_signage_total > 0) {
    lineItems.push({
      description: `Digital Signage - ${quote.num_buildings} building(s) @ $1,500/building/year`,
      quantity: 1,
      unitAmount: quote.digital_signage_total,
      accountCode: '200',
      taxType: 'OUTPUT',
    });
  }

  if (quote.visitor_mgmt_total > 0) {
    lineItems.push({
      description: `Visitor Management - ${quote.num_buildings} building(s) @ $5,000/building/year`,
      quantity: 1,
      unitAmount: quote.visitor_mgmt_total,
      accountCode: '200',
      taxType: 'OUTPUT',
    });
  }

  if (quote.env_monitoring_total > 0) {
    lineItems.push({
      description: `Environmental Monitoring - ${quote.num_floors} floors @ $2,000/floor/year`,
      quantity: 1,
      unitAmount: quote.env_monitoring_total,
      accountCode: '200',
      taxType: 'OUTPUT',
    });
  }

  if (quote.space_util_total > 0) {
    lineItems.push({
      description: `Space Utilisation - ${quote.num_floors} floors @ $2,000/floor/year`,
      quantity: 1,
      unitAmount: quote.space_util_total,
      accountCode: '200',
      taxType: 'OUTPUT',
    });
  }

  if (quote.av_control_total > 0) {
    lineItems.push({
      description: `AV Control - ${quote.num_av_rooms} rooms @ $500/room/year`,
      quantity: 1,
      unitAmount: quote.av_control_total,
      accountCode: '200',
      taxType: 'OUTPUT',
    });
  }

  // Volume discount (negative line item)
  if (quote.discount_amount > 0) {
    const pctLabel = (quote.discount_pct * 100).toFixed(0);
    lineItems.push({
      description: `Volume Discount (${pctLabel}%)`,
      quantity: 1,
      unitAmount: -quote.discount_amount,
      accountCode: '200',
      taxType: 'OUTPUT',
    });
  }

  // Early bird bonus (free setup waiver)
  if (quote.early_bird_bonus) {
    lineItems.push({
      description: 'Early Bird Bonus - Setup fee waived (accepted within 72 hrs)',
      quantity: 1,
      unitAmount: 0,
      accountCode: '200',
      taxType: 'OUTPUT',
    });
  }

  // Setup fees
  if (quote.setup_config > 0) {
    lineItems.push({
      description: 'One-off Setup - Platform Configuration',
      quantity: 1,
      unitAmount: quote.setup_config,
      accountCode: '200',
      taxType: 'OUTPUT',
    });
  }

  if (quote.setup_maps > 0) {
    lineItems.push({
      description: `One-off Setup - Interactive Maps (${quote.num_floors} floors @ $1,000/map)`,
      quantity: 1,
      unitAmount: quote.setup_maps,
      accountCode: '200',
      taxType: 'OUTPUT',
    });
  }

  if (quote.setup_integration > 0) {
    lineItems.push({
      description: 'One-off Setup - Integration & Onboarding',
      quantity: 1,
      unitAmount: quote.setup_integration,
      accountCode: '200',
      taxType: 'OUTPUT',
    });
  }

  return lineItems;
}

// ===== XERO QUOTE =====

async function createXeroQuote(quote) {
  await ensureToken();
  const tenantId = getTenantId();

  const contactId = await findOrCreateContact(quote);
  const lineItems = buildLineItems(quote);

  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30);
  const expiryStr = expiryDate.toISOString().split('T')[0];

  const quoteData = {
    quoteNumber: quote.invoice_number ? `Q-${quote.invoice_number}` : undefined,
    reference: `PlaceOS CampusOS - ${quote.company_name}`,
    contact: { contactID: contactId },
    lineItems,
    date: new Date().toISOString().split('T')[0],
    expiryDate: expiryStr,
    status: 'DRAFT',
    currencyCode: 'USD',
    title: `PlaceOS CampusOS Proposal - ${quote.company_name}`,
    summary: `Annual subscription + one-off setup for ${quote.company_name}`,
  };

  const result = await xero.accountingApi.createQuotes(tenantId, { quotes: [quoteData] });
  const xeroQuote = result.body.quotes[0];
  console.log(`Xero quote created: ${xeroQuote.quoteID}`);
  return xeroQuote.quoteID;
}

// ===== CONVERT QUOTE -> MILESTONE INVOICES =====

async function convertQuoteToInvoice(xeroQuoteId, invoiceNumber, quote) {
  await ensureToken();
  const tenantId = getTenantId();

  const quoteResp = await xero.accountingApi.getQuote(tenantId, xeroQuoteId);
  const xeroQuote = quoteResp.body.quotes[0];
  const contactID = xeroQuote.contact.contactID;
  const currencyCode = xeroQuote.currencyCode || 'USD';
  const today = new Date().toISOString().split('T')[0];

  const annualItems = [];
  const setupItems = [];
  const otherItems = [];

  for (const li of xeroQuote.lineItems) {
    const desc = (li.description || '').toLowerCase();
    if (desc.includes('one-off setup') || desc.includes('platform configuration') || desc.includes('interactive maps') || desc.includes('integration & onboarding')) {
      setupItems.push(li);
    } else if (desc.includes('discount') || desc.includes('early bird')) {
      otherItems.push(li);
    } else {
      annualItems.push(li);
    }
  }

  const mapItem = (li) => ({
    description: li.description,
    quantity: li.quantity,
    unitAmount: li.unitAmount,
    accountCode: li.accountCode || '200',
    taxType: li.taxType || 'OUTPUT',
  });

  // Milestone 1: Annual licence + 50% setup (due now, Net-14)
  const m1LineItems = annualItems.map(mapItem);

  for (const li of otherItems) {
    m1LineItems.push(mapItem(li));
  }

  for (const li of setupItems) {
    m1LineItems.push({
      description: `${li.description} (50% deposit)`,
      quantity: li.quantity,
      unitAmount: (li.unitAmount * 0.5).toFixed(2),
      accountCode: li.accountCode || '200',
      taxType: li.taxType || 'OUTPUT',
    });
  }

  const dueDate1 = new Date();
  dueDate1.setDate(dueDate1.getDate() + 14);

  const invoice1Data = {
    type: 'ACCREC',
    invoiceNumber: `${invoiceNumber}-M1`,
    reference: `${xeroQuote.reference} — Milestone 1 (Deposit)`,
    contact: { contactID },
    lineItems: m1LineItems,
    date: today,
    dueDate: dueDate1.toISOString().split('T')[0],
    status: 'AUTHORISED',
    currencyCode,
  };

  // Milestone 2: Remaining 50% setup (due on completion, Net-30)
  const m2LineItems = setupItems.map((li) => ({
    description: `${li.description} (final 50%)`,
    quantity: li.quantity,
    unitAmount: (li.unitAmount * 0.5).toFixed(2),
    accountCode: li.accountCode || '200',
    taxType: li.taxType || 'OUTPUT',
  }));

  const dueDate2 = new Date();
  dueDate2.setDate(dueDate2.getDate() + 30);

  const invoice2Data = {
    type: 'ACCREC',
    invoiceNumber: `${invoiceNumber}-M2`,
    reference: `${xeroQuote.reference} — Milestone 2 (Completion)`,
    contact: { contactID },
    lineItems: m2LineItems,
    date: today,
    dueDate: dueDate2.toISOString().split('T')[0],
    status: 'DRAFT',
    currencyCode,
  };

  const result = await xero.accountingApi.createInvoices(tenantId, {
    invoices: [invoice1Data, invoice2Data],
  });

  const invoice1 = result.body.invoices[0];
  const invoice2 = result.body.invoices[1];

  try {
    await xero.accountingApi.updateQuote(tenantId, xeroQuoteId, {
      quotes: [{ quoteID: xeroQuoteId, status: 'ACCEPTED' }],
    });
  } catch (e) {
    console.warn('Could not update Xero quote status:', e.message);
  }

  console.log(`Xero Milestone 1 invoice: ${invoice1.invoiceID} (${invoiceNumber}-M1) — AUTHORISED`);
  console.log(`Xero Milestone 2 invoice: ${invoice2.invoiceID} (${invoiceNumber}-M2) — DRAFT`);

  return {
    depositInvoiceId: invoice1.invoiceID,
    finalInvoiceId: invoice2.invoiceID,
    depositInvoiceNumber: `${invoiceNumber}-M1`,
    finalInvoiceNumber: `${invoiceNumber}-M2`,
  };
}

// ===== EMAIL INVOICE =====

async function emailInvoice(xeroInvoiceId, recipientEmail) {
  await ensureToken();
  const tenantId = getTenantId();

  const requestEmpty = {};
  await xero.accountingApi.emailInvoice(tenantId, xeroInvoiceId, requestEmpty);
  console.log(`Invoice ${xeroInvoiceId} emailed via Xero to ${recipientEmail}`);
}

// ===== INVOICE PDF =====

async function getInvoicePdf(xeroInvoiceId) {
  try {
    await ensureToken();
    const tenantId = getTenantId();
    const response = await xero.accountingApi.getInvoiceAsPdf(
      tenantId,
      xeroInvoiceId,
      { headers: { 'Accept': 'application/pdf' } }
    );
    let pdfData;
    if (Buffer.isBuffer(response.body)) {
      pdfData = response.body;
    } else if (response.body instanceof ArrayBuffer) {
      pdfData = Buffer.from(response.body);
    } else if (typeof response.body === 'string') {
      pdfData = Buffer.from(response.body, 'binary');
    } else {
      pdfData = response.response?.data ? Buffer.from(response.response.data) : null;
    }
    if (pdfData && pdfData.length > 0) {
      console.log(`Invoice PDF downloaded for ${xeroInvoiceId} (${pdfData.length} bytes)`);
      return pdfData;
    }
    console.error('Invoice PDF response was empty');
    return null;
  } catch (err) {
    console.error('Failed to get invoice PDF from Xero:', err.message);
    return null;
  }
}

// ===== ORGANISATION / BANK DETAILS =====

async function getOrganisationDetails() {
  try {
    await ensureToken();
    const tenantId = getTenantId();
    const response = await xero.accountingApi.getOrganisations(tenantId);
    const org = response.body.organisations?.[0];
    if (!org) return null;
    return {
      name: org.name,
      legalName: org.legalName,
      taxNumber: org.taxNumber,
      lineOfBusiness: org.lineOfBusiness,
      addresses: org.addresses,
    };
  } catch (err) {
    console.error('Failed to get Xero org details:', err.message);
    return null;
  }
}

async function getBankAccount() {
  try {
    await ensureToken();
    const tenantId = getTenantId();
    const response = await xero.accountingApi.getAccounts(tenantId, undefined, 'Type=="BANK" AND Status=="ACTIVE"');
    const accounts = response.body.accounts;
    if (!accounts || accounts.length === 0) return null;
    const bank = accounts[0];
    return {
      name: bank.name,
      bankAccountNumber: bank.bankAccountNumber,
      currencyCode: bank.currencyCode,
    };
  } catch (err) {
    console.error('Failed to get Xero bank details:', err.message);
    return null;
  }
}

module.exports = {
  xero,
  initializeXero,
  saveTokens,
  loadTokens,
  createXeroQuote,
  convertQuoteToInvoice,
  emailInvoice,
  getOrganisationDetails,
  getBankAccount,
  getInvoicePdf,
};
