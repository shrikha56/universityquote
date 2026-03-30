const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.FROM_EMAIL || 'PlaceOS CampusOS <onboarding@resend.dev>';
const ADMIN_EMAIL = 'sales@place.technology';

// Send quote confirmation email when a proposal is generated
async function sendQuoteEmail(quote) {
  const proposalUrl = quote.pin_code
    ? `${process.env.BASE_URL}/${quote.slug}?pin=${encodeURIComponent(quote.pin_code)}`
    : `${process.env.BASE_URL}/${quote.slug}`;

  if (!resend) { console.log('Email sending disabled (no RESEND_API_KEY)'); return false; }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: quote.contact_email,
      bcc: ADMIN_EMAIL,
      subject: `Your PlaceOS CampusOS Proposal for ${quote.company_name}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1a3a5c; padding: 40px; text-align: center; color: white;">
            <div style="font-size: 1.6em; font-weight: 700; letter-spacing: -0.5px;">Place<span style="opacity:0.6; font-weight:300;">OS</span></div>
            <h1 style="margin: 8px 0 0 0; font-size: 1.6em; font-weight: 300;">Your Proposal is Ready</h1>
          </div>
          <div style="padding: 40px; background: #f5f6f8;">
            <p style="font-size: 1.1em; color: #333;">Hi ${quote.contact_name},</p>
            <p style="color: #555;">Thank you for configuring a PlaceOS CampusOS proposal for <strong>${quote.company_name}</strong>. Your custom quote is ready to review.</p>
            <div style="background: white; border-radius: 8px; padding: 20px; margin: 24px 0; border: 1px solid #e0e0e0;">
              <p style="margin: 0 0 12px 0; font-weight: 600; color: #1a3a5c;">Quote Summary</p>
              ${quote.num_bookable_spaces > 0 ? `<p style="margin: 4px 0; font-size: 0.9em; color: #555;">Bookable Spaces: ${quote.num_bookable_spaces} spaces</p>` : ''}
              ${quote.num_parking_spaces > 0 ? `<p style="margin: 4px 0; font-size: 0.9em; color: #555;">Campus Parking: ${quote.num_parking_spaces} spaces</p>` : ''}
              ${quote.num_floors > 0 ? `<p style="margin: 4px 0; font-size: 0.9em; color: #555;">Environmental Monitoring &amp; Space Utilisation: ${quote.num_floors} floors</p>` : ''}
              ${quote.num_av_rooms > 0 ? `<p style="margin: 4px 0; font-size: 0.9em; color: #555;">AV Control: ${quote.num_av_rooms} rooms</p>` : ''}
              ${quote.include_digital_signage ? `<p style="margin: 4px 0; font-size: 0.9em; color: #555;">Digital Signage: ${quote.num_buildings} building(s)</p>` : ''}
              ${quote.include_visitor_mgmt ? `<p style="margin: 4px 0; font-size: 0.9em; color: #555;">Visitor Management: ${quote.num_buildings} building(s)</p>` : ''}
              <div style="border-top: 1px solid #eee; margin-top: 12px; padding-top: 12px;">
                <p style="margin: 0; font-size: 1.1em; font-weight: 700; color: #1a3a5c;">Annual Licence: $${quote.total_annual.toLocaleString()} USD</p>
                <p style="margin: 4px 0 0 0; font-size: 0.85em; color: #888;">+ One-time setup: $${quote.setup_total.toLocaleString()} USD</p>
              </div>
            </div>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${proposalUrl}" style="display: inline-block; background: #1a3a5c; color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 1.1em;">View Your Proposal</a>
            </div>
            ${quote.pin_code ? `<p style="background: #fef9ec; border-left: 3px solid #d4a017; padding: 12px 16px; border-radius: 0 6px 6px 0; font-size: 0.9em; color: #7a6012;">Your proposal is PIN-protected. Use PIN: <strong>${quote.pin_code}</strong> to access it.</p>` : ''}
            <p style="color: #555; font-size: 0.9em;">This proposal is valid for 30 days. Sign within 72 hours to receive a $2,000 implementation credit.</p>
            <p style="color: #555;">Questions? Contact <a href="mailto:sales@place.technology" style="color: #4a90d9;">sales@place.technology</a></p>
            <p style="margin-top: 32px; color: #555;">Best regards,<br><strong>PlaceOS Sales Team</strong></p>
          </div>
          <div style="background: #0e1a2e; color: #666; padding: 24px; text-align: center; font-size: 0.82em;">
            <p style="margin: 0;">Place Technology Pty Ltd</p>
            <p style="margin: 4px 0 0 0;">place.technology | sales@place.technology</p>
          </div>
        </div>
      `
    });

    if (error) {
      console.error('Resend error sending quote email:', error);
      return false;
    }
    console.log(`Quote confirmation email sent to ${quote.contact_email} (id: ${data.id})`);
    return true;
  } catch (error) {
    console.error('Error sending quote email:', error.message);
    return false;
  }
}

// Send follow-up reminder email
async function sendFollowUpEmail(quote) {
  const proposalUrl = quote.pin_code
    ? `${process.env.BASE_URL}/${quote.slug}?pin=${encodeURIComponent(quote.pin_code)}`
    : `${process.env.BASE_URL}/${quote.slug}`;

  if (!resend) { console.log('Email sending disabled (no RESEND_API_KEY)'); return false; }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: quote.contact_email,
      bcc: ADMIN_EMAIL,
      subject: `${quote.contact_name}, still interested in PlaceOS CampusOS?`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1a3a5c; padding: 40px; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 1.8em; font-weight: 300;">PlaceOS CampusOS</h1>
          </div>
          <div style="padding: 40px; background: #f5f6f8;">
            <p style="font-size: 1.1em; color: #333;">Hi ${quote.contact_name},</p>
            <p style="color: #555;">I noticed you viewed your custom PlaceOS CampusOS proposal for <strong>${quote.company_name}</strong>, but haven't had a chance to accept it yet.</p>
            <p style="color: #555;">Your proposal includes:</p>
            <ul style="color: #555;">
              ${quote.num_bookable_spaces > 0 ? `<li>Bookable Spaces for ${quote.num_bookable_spaces} spaces</li>` : ''}
              ${quote.num_parking_spaces > 0 ? `<li>Campus Parking for ${quote.num_parking_spaces} spaces</li>` : ''}
              ${quote.num_floors > 0 ? `<li>Environmental Monitoring & Space Utilisation for ${quote.num_floors} floors</li>` : ''}
              ${quote.num_av_rooms > 0 ? `<li>AV Control for ${quote.num_av_rooms} rooms</li>` : ''}
              ${quote.include_digital_signage ? `<li>Digital Signage</li>` : ''}
              ${quote.include_visitor_mgmt ? `<li>Visitor Management</li>` : ''}
            </ul>
            <p style="color: #333;"><strong>Total Investment:</strong> $${(quote.total_annual + quote.setup_total * 0.5).toLocaleString()} USD</p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${proposalUrl}" style="display: inline-block; background: #1a3a5c; color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 1.1em;">Review Your Proposal</a>
            </div>
            <p style="color: #666; font-size: 0.9em; border-left: 3px solid #1a3a5c; padding-left: 16px;">Your proposal expires on ${new Date(quote.expires_at).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}.</p>
            <p style="color: #555;">Have questions? Just reply to this email.</p>
            <p style="margin-top: 32px; color: #555;">Best regards,<br><strong>PlaceOS Sales Team</strong></p>
          </div>
          <div style="background: #0e1a2e; color: #666; padding: 24px; text-align: center; font-size: 0.82em;">
            <p style="margin: 0;">Place Technology Pty Ltd</p>
          </div>
        </div>
      `
    });

    if (error) {
      console.error('Resend error sending follow-up:', error);
      return false;
    }
    console.log(`Follow-up email sent to ${quote.contact_email} (id: ${data.id})`);
    return true;
  } catch (error) {
    console.error('Error sending follow-up email:', error.message);
    return false;
  }
}

// Send downsell offer email
async function sendDownsellEmail(quote, discountPct) {
  const proposalUrl = quote.pin_code
    ? `${process.env.BASE_URL}/${quote.slug}?pin=${encodeURIComponent(quote.pin_code)}`
    : `${process.env.BASE_URL}/${quote.slug}`;

  const originalTotal = quote.total_annual + quote.setup_total * 0.5;
  const discountAmount = originalTotal * (discountPct / 100);
  const newTotal = originalTotal - discountAmount;

  if (!resend) { console.log('Email sending disabled (no RESEND_API_KEY)'); return false; }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: quote.contact_email,
      bcc: ADMIN_EMAIL,
      subject: `Special ${discountPct}% Discount on Your PlaceOS CampusOS Proposal`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1a3a5c; padding: 40px; text-align: center; color: white;">
            <h2 style="margin: 0; font-size: 1.8em; font-weight: 300;">Special Offer for ${quote.company_name}</h2>
          </div>
          <div style="padding: 40px; background: #f5f6f8;">
            <p style="font-size: 1.1em; color: #333;">Hi ${quote.contact_name},</p>
            <p style="color: #555;">I'd like to offer you a <strong style="color: #1a3a5c; font-size: 1.1em;">${discountPct}% special discount</strong> on your PlaceOS CampusOS proposal.</p>
            <div style="background: white; border-radius: 8px; padding: 24px; margin: 24px 0; border: 1px solid #e0e0e0;">
              <table style="width: 100%;">
                <tr><td style="padding: 8px 0; color: #666;">Original Price:</td><td style="padding: 8px 0; text-align: right;"><span style="text-decoration: line-through; color: #999;">$${originalTotal.toLocaleString()} USD</span></td></tr>
                <tr style="color: #1a8a4a; font-weight: 600;"><td style="padding: 8px 0;">Discount (${discountPct}%):</td><td style="padding: 8px 0; text-align: right;">-$${discountAmount.toLocaleString()} USD</td></tr>
                <tr style="border-top: 2px solid #eee;"><td style="padding: 16px 0 0 0; font-size: 1.2em; font-weight: 700; color: #1a3a5c;">New Total:</td><td style="padding: 16px 0 0 0; text-align: right; font-size: 1.3em; font-weight: 700; color: #1a3a5c;">$${newTotal.toLocaleString()} USD</td></tr>
              </table>
            </div>
            <p style="background: #fef9ec; border-left: 3px solid #d4a017; padding: 12px 16px; border-radius: 0 6px 6px 0; font-size: 0.9em; color: #7a6012;"><strong>Limited Time:</strong> This pricing is available for the next <strong>7 days only</strong>.</p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${proposalUrl}" style="display: inline-block; background: #1a3a5c; color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 1.1em;">Accept Special Offer</a>
            </div>
            <p style="color: #555;">Questions? Just reply to this email.</p>
            <p style="margin-top: 32px; color: #555;">Best regards,<br><strong>PlaceOS Sales Team</strong></p>
          </div>
          <div style="background: #0e1a2e; color: #666; padding: 24px; text-align: center; font-size: 0.82em;">
            <p style="margin: 0;">Place Technology Pty Ltd</p>
          </div>
        </div>
      `
    });

    if (error) {
      console.error('Resend error sending downsell:', error);
      return false;
    }
    console.log(`Downsell email sent to ${quote.contact_email} (id: ${data.id})`);
    return true;
  } catch (error) {
    console.error('Error sending downsell email:', error.message);
    return false;
  }
}

// Send acceptance confirmation email with Xero invoice PDF attached
async function sendAcceptanceEmail(quote, pdfBuffer, xeroPaymentUrl) {
  const proposalUrl = `${process.env.BASE_URL}/${quote.slug}`;

  const attachments = [];
  if (pdfBuffer) {
    attachments.push({
      filename: `${quote.invoice_number}.pdf`,
      content: pdfBuffer.toString('base64'),
    });
  }

  if (!resend) { console.log('Email sending disabled (no RESEND_API_KEY)'); return false; }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: quote.contact_email,
      bcc: ADMIN_EMAIL,
      subject: `Invoice ${quote.invoice_number} — PlaceOS CampusOS for ${quote.company_name}`,
      attachments,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1a3a5c; padding: 40px; text-align: center; color: white;">
            <div style="font-size: 1.6em; font-weight: 700; letter-spacing: -0.5px;">Place<span style="opacity:0.6; font-weight:300;">OS</span></div>
            <h1 style="margin: 8px 0 0 0; font-size: 1.6em; font-weight: 300;">Proposal Accepted</h1>
          </div>
          <div style="padding: 40px; background: #f5f6f8;">
            <p style="font-size: 1.1em; color: #333;">Hi ${quote.contact_name},</p>
            <p style="color: #555;">Thank you for accepting the PlaceOS CampusOS proposal for <strong>${quote.company_name}</strong>. Your invoice <strong>${quote.invoice_number}</strong> is attached as a PDF.</p>
            ${quote.early_bird_bonus ? '<p style="background: #eef7f0; border-left: 3px solid #1a8a4a; padding: 12px 16px; border-radius: 0 6px 6px 0; font-size: 0.9em; color: #1a6a3a;"><strong>Early Bird Bonus Applied:</strong> $2,000 implementation credit has been applied to your invoice.</p>' : ''}
            <div style="background: white; border-radius: 8px; padding: 20px; margin: 24px 0; border: 1px solid #e0e0e0;">
              <p style="margin: 0 0 8px 0; font-weight: 600; color: #1a3a5c;">Next Steps</p>
              <p style="margin: 4px 0; font-size: 0.9em; color: #555;">1. Review the attached invoice</p>
              <p style="margin: 4px 0; font-size: 0.9em; color: #555;">2. Arrange payment per the terms outlined</p>
              <p style="margin: 4px 0; font-size: 0.9em; color: #555;">3. Book your kickoff meeting with our deployment team</p>
            </div>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${proposalUrl}" style="display: inline-block; background: #1a3a5c; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 1em; margin-right: 12px;">View Proposal Online</a>
              ${xeroPaymentUrl ? `<a href="${xeroPaymentUrl}" style="display: inline-block; background: #1a8a4a; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 1em;">Make Payment</a>` : ''}
            </div>
            <p style="color: #555;">Questions? Contact <a href="mailto:accounts@place.technology" style="color: #4a90d9;">accounts@place.technology</a></p>
            <p style="margin-top: 32px; color: #555;">Welcome aboard,<br><strong>PlaceOS Team</strong></p>
          </div>
          <div style="background: #0e1a2e; color: #666; padding: 24px; text-align: center; font-size: 0.82em;">
            <p style="margin: 0;">Place Technology Pty Ltd</p>
            <p style="margin: 4px 0 0 0;">place.technology | accounts@place.technology</p>
          </div>
        </div>
      `
    });

    if (error) {
      console.error('Resend error sending acceptance email:', error);
      return false;
    }
    console.log(`Acceptance email with PDF sent to ${quote.contact_email} (id: ${data.id})`);
    return true;
  } catch (error) {
    console.error('Error sending acceptance email:', error.message);
    return false;
  }
}

// Send admin notification email to sales team
async function sendAdminNotification(event, quote) {
  if (!resend) return false;

  const proposalUrl = `${process.env.BASE_URL}/${quote.slug}`;
  const adminDashUrl = process.env.BASE_URL + '/admin/dashboard';

  const subjects = {
    new_quote: `New Quote: ${quote.company_name} — $${quote.total_annual?.toLocaleString() || '0'}/yr`,
    accepted: `Quote Accepted: ${quote.company_name} — ${quote.signature_name || quote.contact_name}`,
    expired: `Quote Expired: ${quote.company_name} (no action taken)`,
  };

  const bodies = {
    new_quote: `
      <p>A new CampusOS quote has been generated.</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr><td style="padding:8px; color:#888; width:140px;">Company</td><td style="padding:8px; font-weight:600;">${quote.company_name}</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:8px; color:#888;">Contact</td><td style="padding:8px;">${quote.contact_name} (${quote.contact_email})</td></tr>
        <tr><td style="padding:8px; color:#888;">Annual Licence</td><td style="padding:8px; font-weight:600; color:#1a8a4a;">$${quote.total_annual?.toLocaleString() || '0'} USD</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:8px; color:#888;">Setup Fees</td><td style="padding:8px;">$${quote.setup_total?.toLocaleString() || '0'} USD</td></tr>
        ${quote.num_bookable_spaces > 0 ? `<tr><td style="padding:8px; color:#888;">Bookable Spaces</td><td style="padding:8px;">${quote.num_bookable_spaces}</td></tr>` : ''}
        ${quote.num_parking_spaces > 0 ? `<tr style="background:#f9fafb;"><td style="padding:8px; color:#888;">Parking Spaces</td><td style="padding:8px;">${quote.num_parking_spaces}</td></tr>` : ''}
        ${quote.num_floors > 0 ? `<tr><td style="padding:8px; color:#888;">Floors</td><td style="padding:8px;">${quote.num_floors}</td></tr>` : ''}
        ${quote.num_av_rooms > 0 ? `<tr style="background:#f9fafb;"><td style="padding:8px; color:#888;">AV Rooms</td><td style="padding:8px;">${quote.num_av_rooms}</td></tr>` : ''}
        ${quote.num_buildings > 0 ? `<tr><td style="padding:8px; color:#888;">Buildings</td><td style="padding:8px;">${quote.num_buildings}</td></tr>` : ''}
      </table>`,
    accepted: `
      <p>A CampusOS quote has been <strong style="color:#1a8a4a;">accepted and signed</strong>.</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr><td style="padding:8px; color:#888; width:140px;">Company</td><td style="padding:8px; font-weight:600;">${quote.company_name}</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:8px; color:#888;">Signed by</td><td style="padding:8px;">${quote.signature_name || quote.contact_name}</td></tr>
        <tr><td style="padding:8px; color:#888;">Contact</td><td style="padding:8px;">${quote.contact_name} (${quote.contact_email})</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:8px; color:#888;">Annual Licence</td><td style="padding:8px; font-weight:600; color:#1a8a4a;">$${quote.total_annual?.toLocaleString() || '0'} USD</td></tr>
        <tr><td style="padding:8px; color:#888;">Invoice</td><td style="padding:8px;">${quote.invoice_number || 'N/A'}</td></tr>
        ${quote.early_bird_bonus ? '<tr style="background:#eef7f0;"><td style="padding:8px; color:#888;">Early Bird</td><td style="padding:8px; color:#1a8a4a; font-weight:600;">$2,000 credit applied</td></tr>' : ''}
      </table>`,
    expired: `
      <p>A CampusOS quote has <strong style="color:#d4a017;">expired</strong> without being accepted.</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr><td style="padding:8px; color:#888; width:140px;">Company</td><td style="padding:8px; font-weight:600;">${quote.company_name}</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:8px; color:#888;">Contact</td><td style="padding:8px;">${quote.contact_name} (${quote.contact_email})</td></tr>
        <tr><td style="padding:8px; color:#888;">Annual Value</td><td style="padding:8px;">$${quote.total_annual?.toLocaleString() || '0'} USD</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:8px; color:#888;">Created</td><td style="padding:8px;">${quote.created_at || 'N/A'}</td></tr>
      </table>
      <p style="color:#666; font-size:0.9em;">Consider sending a follow-up or downsell offer from the admin dashboard.</p>`,
  };

  const eventLabels = { new_quote: 'New Quote', accepted: 'Accepted', expired: 'Expired' };
  const eventColors = { new_quote: '#4a90d9', accepted: '#1a8a4a', expired: '#d4a017' };

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: subjects[event] || `Quote Update: ${quote.company_name}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1a3a5c; padding: 30px 40px; color: white;">
            <div style="font-size: 1.4em; font-weight: 700; letter-spacing: -0.5px;">Place<span style="opacity:0.6; font-weight:300;">OS</span> <span style="font-weight:300; font-size:0.7em; opacity:0.6;">CampusOS Sales</span></div>
          </div>
          <div style="padding: 32px 40px; background: white; border: 1px solid #e8e9ed;">
            <div style="display:inline-block; padding:4px 12px; background:${eventColors[event]}; color:white; border-radius:4px; font-size:0.8em; font-weight:600; margin-bottom:16px;">${eventLabels[event]}</div>
            ${bodies[event]}
            <div style="margin-top:24px; display:flex; gap:12px;">
              <a href="${proposalUrl}" style="display:inline-block; padding:10px 24px; background:#1a3a5c; color:white; border-radius:6px; font-weight:600; font-size:0.9em; text-decoration:none;">View Proposal</a>
              <a href="${adminDashUrl}" style="display:inline-block; padding:10px 24px; background:white; color:#1a3a5c; border:1.5px solid #1a3a5c; border-radius:6px; font-weight:600; font-size:0.9em; text-decoration:none;">Admin Dashboard</a>
            </div>
          </div>
          <div style="background: #f5f6f8; padding: 16px 40px; text-align: center; font-size: 0.8em; color: #999;">
            PlaceOS CampusOS Admin Notification · sales@place.technology
          </div>
        </div>
      `
    });
    if (error) { console.error(`Admin notification error (${event}):`, error); return false; }
    console.log(`Admin notification (${event}) sent for ${quote.company_name}`);
    return true;
  } catch (error) {
    console.error(`Error sending admin notification (${event}):`, error.message);
    return false;
  }
}

// Test email configuration
async function testEmailConfig() {
  if (!process.env.RESEND_API_KEY) {
    console.log('No RESEND_API_KEY set — email sending disabled');
    return false;
  }
  console.log('Resend email service configured');
  return true;
}

module.exports = {
  sendQuoteEmail,
  sendAcceptanceEmail,
  sendFollowUpEmail,
  sendDownsellEmail,
  sendAdminNotification,
  testEmailConfig
};
