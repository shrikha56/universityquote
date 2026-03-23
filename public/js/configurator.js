// PlaceOS CampusOS — Quote Configurator
(function() {
  const PRICES = {
    bookable_spaces: { rate: 120 },
    floors: { rate: 4000 }, // env_monitoring + space_util
    parking_spaces: { rate: 36 },
    av_rooms: { rate: 500 },
  };
  const SETUP = { config: 6000, mapPerFloor: 1000, integration: 5000 };

  const form = document.getElementById('quoteForm');
  const inputs = form.querySelectorAll('.qty-input');
  const contactInputs = form.querySelectorAll('#contact_name, #contact_email, #company_name');

  // +/- buttons
  document.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      let val = parseInt(input.value) || 0;
      if (btn.classList.contains('minus')) val = Math.max(0, val - 1);
      else val += 1;
      input.value = val;
      input.dispatchEvent(new Event('input'));
    });
  });

  // Recalculate on any input change
  inputs.forEach(i => i.addEventListener('input', recalc));
  contactInputs.forEach(i => i.addEventListener('input', checkReady));

  // Checkbox listeners
  const digitalSignageCheckbox = document.getElementById('include_digital_signage');
  const visitorCheckbox = document.getElementById('include_visitor_mgmt');
  if (digitalSignageCheckbox) digitalSignageCheckbox.addEventListener('change', recalc);
  if (visitorCheckbox) visitorCheckbox.addEventListener('change', recalc);

  function val(id) { return parseInt(document.getElementById(id).value) || 0; }
  function fmt(n) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0 }); }

  function recalc() {
    const bookableSpaces = val('num_bookable_spaces');
    const floors = val('num_floors');
    const parkingSpaces = val('num_parking_spaces');
    const avRooms = val('num_av_rooms');
    const buildings = val('num_buildings') || 1;
    const includeDigitalSignage = digitalSignageCheckbox && digitalSignageCheckbox.checked;
    const includeVisitorMgmt = visitorCheckbox && visitorCheckbox.checked;

    // Per-item subtotals
    const lineItems = {};
    lineItems.bookable_spaces = bookableSpaces * PRICES.bookable_spaces.rate;
    lineItems.floors = floors * PRICES.floors.rate;
    lineItems.parking_spaces = parkingSpaces * PRICES.parking_spaces.rate;
    lineItems.av_rooms = avRooms * PRICES.av_rooms.rate;
    const digitalSignageTotal = includeDigitalSignage ? (buildings * 1500) : 0;
    const visitorTotal = includeVisitorMgmt ? (buildings * 5000) : 0;

    // Update card subtotals
    Object.keys(lineItems).forEach(k => {
      const el = document.querySelector(`.asset-subtotal[data-for="${k}"]`);
      if (el) el.textContent = fmt(lineItems[k]);
    });
    const digitalSignageSubtotalEl = document.querySelector(`.asset-subtotal[data-for="digital_signage"]`);
    if (digitalSignageSubtotalEl) digitalSignageSubtotalEl.textContent = fmt(digitalSignageTotal);
    const visitorSubtotalEl = document.querySelector(`.asset-subtotal[data-for="visitor_mgmt"]`);
    if (visitorSubtotalEl) visitorSubtotalEl.textContent = fmt(visitorTotal);

    // Active state on cards
    document.querySelectorAll('.asset-card').forEach(card => {
      const input = card.querySelector('.qty-input');
      if (input) {
        card.classList.toggle('active', parseInt(input.value) > 0);
      } else {
        const checkbox = card.querySelector('input[type="checkbox"]');
        if (checkbox) {
          card.classList.toggle('active', checkbox.checked);
        }
      }
    });

    // Build summary lines
    const summaryEl = document.getElementById('summaryLines');
    summaryEl.innerHTML = '';
    const items = [
      { label: `Bookable Spaces — ${bookableSpaces} spaces × $120`, amt: lineItems.bookable_spaces, show: bookableSpaces > 0 },
      { label: `Environmental Monitoring — ${floors} floors × $2,000`, amt: floors * 2000, show: floors > 0 },
      { label: `Space Utilisation — ${floors} floors × $2,000`, amt: floors * 2000, show: floors > 0 },
      { label: `Campus Parking — ${parkingSpaces} spaces × $36`, amt: lineItems.parking_spaces, show: parkingSpaces > 0 },
      { label: `AV Control — ${avRooms} rooms × $500`, amt: lineItems.av_rooms, show: avRooms > 0 },
      { label: `Digital Signage — ${buildings} building(s) × $1,500`, amt: digitalSignageTotal, show: includeDigitalSignage },
      { label: `Visitor Management — ${buildings} building(s) × $5,000`, amt: visitorTotal, show: includeVisitorMgmt },
    ];

    const visibleItems = items.filter(i => i.show);
    if (visibleItems.length === 0) {
      summaryEl.innerHTML = '<div class="summary-empty">Add items above to see your quote</div>';
    } else {
      visibleItems.forEach(i => {
        const div = document.createElement('div');
        div.className = 'summary-line-item';
        div.innerHTML = `<span>${i.label}</span><span class="amt">${fmt(i.amt)}</span>`;
        summaryEl.appendChild(div);
      });
    }

    const subtotal = Object.values(lineItems).reduce((a,b) => a+b, 0) + digitalSignageTotal + visitorTotal;

    // Discount tiers
    let discPct = 0;
    if (subtotal >= 100000) discPct = 20;
    else if (subtotal >= 50000) discPct = 15;
    else if (subtotal >= 25000) discPct = 10;
    else if (subtotal >= 10000) discPct = 5;

    const discAmt = subtotal * (discPct / 100);
    const total = subtotal - discAmt;

    document.getElementById('sumSubtotal').textContent = fmt(subtotal);
    const discLine = document.getElementById('discountLine');
    if (discPct > 0) {
      discLine.style.display = 'flex';
      document.getElementById('discountPct').textContent = discPct;
      document.getElementById('sumDiscount').textContent = '\u2212' + fmt(discAmt);
    } else {
      discLine.style.display = 'none';
    }
    document.getElementById('sumTotal').textContent = fmt(total);

    // Setup fees
    const setupMaps = floors * SETUP.mapPerFloor;
    const setupTotal = SETUP.config + setupMaps + SETUP.integration;
    document.getElementById('mapCount').textContent = floors;
    document.getElementById('sumMaps').textContent = fmt(setupMaps);
    document.getElementById('sumSetup').textContent = fmt(setupTotal);

    checkReady();
  }

  function checkReady() {
    const name = document.getElementById('contact_name').value.trim();
    const email = document.getElementById('contact_email').value.trim();
    const company = document.getElementById('company_name').value.trim();
    const hasItems = ['num_bookable_spaces','num_floors','num_parking_spaces','num_av_rooms']
      .some(id => val(id) > 0);
    const hasCheckbox = (digitalSignageCheckbox && digitalSignageCheckbox.checked) ||
                        (visitorCheckbox && visitorCheckbox.checked);
    document.getElementById('generateBtn').disabled = !(name && email && company && (hasItems || hasCheckbox));
  }

  // Form submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('generateBtn');
    btn.querySelector('.btn-text').style.display = 'none';
    btn.querySelector('.btn-loading').style.display = 'inline';
    btn.disabled = true;

    const data = new FormData(form);
    const body = {};
    data.forEach((v, k) => body[k] = v);

    try {
      const res = await fetch('/generate-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        window.location.href = '/' + json.slug;
      } else {
        alert(json.error || 'Something went wrong.');
      }
    } catch (err) {
      alert('Network error. Please try again.');
    } finally {
      btn.querySelector('.btn-text').style.display = 'inline';
      btn.querySelector('.btn-loading').style.display = 'none';
      btn.disabled = false;
    }
  });

  recalc();
})();
