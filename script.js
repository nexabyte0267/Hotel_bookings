// --- 1. SUPABASE CONFIGURATION ---
const SUPABASE_URL = 'https://nkrtyzgubdsddgxdzwoy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_EEzg-G-avzyPEfWyq17xyQ_fPCEuQ8B';

// Check that the keys exist and do not contain placeholder text
const supabaseConfigured =
  SUPABASE_URL && !SUPABASE_URL.includes('YOUR_PROJECT_ID') &&
  SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY');

const db = supabaseConfigured && window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

if (!db) {
  console.warn("Supabase is not configured properly. Running in offline/fallback mode.");
}
// State data with LocalStorage offline backup
function readCache(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    console.warn(`Could not read ${key} from local storage:`, error);
    return [];
  }
}

let rooms = readCache('pms_rooms_cache');
let bookings = readCache('pms_bookings_cache');
let currentActiveTab = 'frontdesk';

function cacheLocally() {
  try {
    localStorage.setItem('pms_rooms_cache', JSON.stringify(rooms));
    localStorage.setItem('pms_bookings_cache', JSON.stringify(bookings));
  } catch (err) {
    console.warn('Local storage unavailable:', err);
  }
}

// --- 2. AUTHENTICATION ---
async function checkAuthSession() {
  if (!db) {
    const errBox = document.getElementById('authError');
    errBox.innerText = 'Supabase is not configured. Add your project URL and anon key to script.js.';
    errBox.style.display = 'block';
    document.getElementById('authOverlay').style.display = 'flex';
    return;
  }

  try {
    const { data: { session }, error } = await db.auth.getSession();
    if (error) throw error;
    if (session) {
      document.getElementById('authOverlay').style.display = 'none';
      document.getElementById('loggedInUser').innerText = session.user.email;
      loadPMSData();
      subscribeRealtime();
    } else {
      document.getElementById('authOverlay').style.display = 'flex';
    }
  } catch (error) {
    const errBox = document.getElementById('authError');
    errBox.innerText = error.message || 'Could not verify the staff session.';
    errBox.style.display = 'block';
    document.getElementById('authOverlay').style.display = 'flex';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  if (!db) {
    const errBox = document.getElementById('authError');
    errBox.innerText = 'Supabase is not configured. Add your project URL and anon key to script.js.';
    errBox.style.display = 'block';
    return;
  }

  const email = document.getElementById('staffEmail').value.trim();
  const password = document.getElementById('staffPassword').value;
  const errBox = document.getElementById('authError');

  try {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      errBox.innerText = error.message;
      errBox.style.display = 'block';
    } else {
      document.getElementById('authOverlay').style.display = 'none';
      document.getElementById('loggedInUser').innerText = data.user.email;
      loadPMSData();
      subscribeRealtime();
    }
  } catch (error) {
    errBox.innerText = error.message || 'Could not reach Supabase.';
    errBox.style.display = 'block';
  }
}

async function handleLogout() {
  if (!db) return;
  await db.auth.signOut();
  location.reload();
}

// --- 3. DATA SYNC & REALTIME ---
async function loadPMSData() {
  if (!db) {
    renderCurrentTab();
    return;
  }

  const [roomsRes, bookingsRes] = await Promise.all([
    db.from('rooms').select('*').order('room_number', { ascending: true }),
    db.from('bookings').select('*').order('created_at', { ascending: false })
  ]);

  if (!roomsRes.error && Array.isArray(roomsRes.data)) rooms = roomsRes.data;
  if (!bookingsRes.error && Array.isArray(bookingsRes.data)) bookings = bookingsRes.data;

  if (roomsRes.error) console.error('Could not load rooms:', roomsRes.error);
  if (bookingsRes.error) console.error('Could not load bookings:', bookingsRes.error);

  cacheLocally();
  renderCurrentTab();
}

function subscribeRealtime() {
  if (!db) return;
  db.channel('hotel-pms-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, loadPMSData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, loadPMSData)
    .subscribe();
}

// --- 4. TAB NAVIGATION & RENDERING ---
function switchTab(tabId) {
  currentActiveTab = tabId;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(`tab-${tabId}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('aside nav a').forEach(el => el.classList.remove('active'));
  const desktopNav = document.getElementById(`nav-${tabId}`);
  if (desktopNav) desktopNav.classList.add('active');

  document.querySelectorAll('.mobile-nav button').forEach(el => el.classList.remove('active'));
  const mobileNav = document.getElementById(`mb-${tabId}`);
  if (mobileNav) mobileNav.classList.add('active');

  const titles = {
    frontdesk: 'Front Desk & Room Operations',
    bookings: 'Bookings & Approvals',
    billing: 'Billing & Folios',
    housekeeping: 'Housekeeping Management'
  };
  const title = document.getElementById('pageTitle');
  if (title) title.innerText = titles[tabId] || 'Hotel Staff PMS';
  renderCurrentTab();
}

function renderStats() {
  const total = rooms.length;
  const occupied = rooms.filter(r => r.status === 'occupied').length;
  const clean = rooms.filter(r => r.status === 'clean').length;
  const dirty = rooms.filter(r => r.status === 'dirty').length;

  document.getElementById('statsBar').innerHTML = `
    <div class="card"><div class="label">Total Rooms</div><div class="value">${total}</div></div>
    <div class="card"><div class="label">Occupied</div><div class="value">${occupied}</div></div>
    <div class="card"><div class="label">Clean & Ready</div><div class="value">${clean}</div></div>
    <div class="card"><div class="label">Needs Cleaning</div><div class="value">${dirty}</div></div>
  `;
}

function renderCurrentTab() {
  renderStats();
  const searchInput = document.getElementById('searchInput');
  const q = (searchInput ? searchInput.value : '').trim().toLowerCase();

  if (currentActiveTab === 'frontdesk') {
    const filtered = rooms.filter(r => {
      const roomNumber = String(r.room_number ?? r.number ?? '');
      const roomType = String(r.room_type ?? r.type ?? '');
      return roomNumber.toLowerCase().includes(q) || roomType.toLowerCase().includes(q);
    });
    document.getElementById('roomTableBody').innerHTML = filtered.map(r => {
      const roomNumber = String(r.room_number ?? r.number ?? '');
      const roomType = String(r.room_type ?? r.type ?? '');
      const status = String(r.status ?? 'clean');
      return `
      <tr>
        <td><strong>${escapeHtml(roomNumber)}</strong></td>
        <td>${escapeHtml(roomType)}</td>
        <td><span class="badge ${escapeHtml(status)}">${escapeHtml(status.toUpperCase())}</span></td>
        <td>
          ${status === 'occupied'
            ? `<button class="secondary" onclick="checkoutRoom('${escapeAttribute(roomNumber)}')">Check Out</button>`
            : status === 'dirty'
            ? `<button onclick="markRoomClean('${escapeAttribute(roomNumber)}')">Mark Clean</button>`
            : `<span style="color:var(--muted); font-size:0.82rem;">Ready</span>`
          }
        </td>
      </tr>
    `}).join('');

    const select = document.getElementById('roomSelect');
    if (select) {
      const available = rooms.filter(r => r.status === 'clean');
      select.innerHTML = available.length
        ? available.map(r => {
            const roomNumber = String(r.room_number ?? r.number ?? '');
            const roomType = String(r.room_type ?? r.type ?? '');
            const rate = Number(r.rate) || 0;
            return `<option value="${escapeAttribute(roomNumber)}">Room ${escapeHtml(roomNumber)} (${escapeHtml(roomType)} - GHS ${rate})</option>`;
          }).join('')
        : `<option value="">No clean rooms available</option>`;
    }
  }

  else if (currentActiveTab === 'bookings') {
    renderBookingsView();
  }

  else if (currentActiveTab === 'billing') {
    const filtered = bookings.filter(b => {
      const guestName = String(b.guest_name ?? '');
      const roomNumber = String(b.room_number ?? '');
      return guestName.toLowerCase().includes(q) || roomNumber.toLowerCase().includes(q);
    });
    document.getElementById('billingTableBody').innerHTML = filtered.map(b => `
      <tr>
        <td><strong>${escapeHtml(b.guest_name)}</strong></td>
        <td>Room ${escapeHtml(b.room_number)}</td>
        <td>GHS ${b.total_amount}</td>
        <td><span class="badge ${escapeHtml(b.payment_status)}">${escapeHtml(String(b.payment_status).toUpperCase())}</span></td>
        <td>
          ${b.payment_status === 'pending' ? `<button onclick="markAsPaid('${escapeAttribute(b.id)}')">Mark Paid</button>` : `<span style="color:var(--muted)">Settled</span>`}
        </td>
      </tr>
    `).join('');
  }

  else if (currentActiveTab === 'housekeeping') {
    const filtered = rooms.filter(r => {
      const roomNumber = String(r.room_number ?? r.number ?? '');
      return roomNumber.toLowerCase().includes(q);
    });
    document.getElementById('housekeepingTableBody').innerHTML = filtered.map(r => {
      const roomNumber = String(r.room_number ?? r.number ?? '');
      const roomType = String(r.room_type ?? r.type ?? '');
      const status = String(r.status ?? 'clean');
      return `
      <tr>
        <td><strong>${escapeHtml(roomNumber)}</strong></td>
        <td>${escapeHtml(roomType)}</td>
        <td><span class="badge ${escapeHtml(status)}">${escapeHtml(status.toUpperCase())}</span></td>
        <td>
          ${status === 'dirty' ? `<button onclick="markRoomClean('${escapeAttribute(roomNumber)}')">Mark Clean</button>` : `<span style="color:var(--muted)">No Action Needed</span>`}
        </td>
      </tr>
    `}).join('');
  }
}

function renderBookingsView() {
  const globalSearch = String(document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  const bookingSearch = String(document.getElementById('bookingSearchInput')?.value || '').trim().toLowerCase();
  const searchTerms = [globalSearch, bookingSearch].filter(Boolean);
  const tbody = document.getElementById('bookingsTableBody');
  if (!tbody) return;

  const filteredBookings = bookings.filter(booking => {
    const searchableValues = [
      String(booking.guest_name ?? '').toLowerCase(),
      String(booking.phone ?? '').toLowerCase(),
      String(booking.room_number ?? '').toLowerCase()
    ];
    return searchTerms.every(term => searchableValues.some(value => value.includes(term)));
  });

  if (filteredBookings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:20px;">No matching bookings found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredBookings.map(booking => `
    <tr>
      <td><strong>${escapeHtml(booking.guest_name || 'Walk-in')}</strong></td>
      <td>${escapeHtml(booking.phone || 'No phone')}</td>
      <td>Room ${escapeHtml(booking.room_number)}</td>
      <td>${escapeHtml(booking.check_in_date || '—')}</td>
      <td>${escapeHtml(booking.check_out_date || '—')}</td>
      <td>${escapeHtml(booking.nights || 1)}</td>
      <td>GHS ${Number(booking.total_amount || 0).toFixed(2)}</td>
      <td><span class="badge ${escapeHtml(booking.booking_status || 'pending')}">${escapeHtml(String(booking.booking_status || 'pending').toUpperCase())}</span></td>
      <td>
        ${booking.booking_status === 'pending' ? `<button onclick="approveBooking('${escapeAttribute(booking.id)}')">Approve</button>` : ''}
        <button class="danger" onclick="deleteBooking('${escapeAttribute(booking.id)}', '${escapeAttribute(booking.room_number)}')">Cancel / Delete</button>
      </td>
    </tr>
  `).join('');
}

// --- 5. PMS ACTIONS (SUPABASE WRITES) ---
function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calculateNights() {
  const checkInInput = document.getElementById('checkInDate');
  const checkOutInput = document.getElementById('checkOutDate');
  const summary = document.getElementById('nightsSummary');
  if (!checkInInput || !checkOutInput) return null;

  if (checkInInput.value) {
    checkOutInput.min = new Date(checkInInput.valueAsNumber + 86400000).toISOString().slice(0, 10);
  }

  const checkInTime = checkInInput.valueAsNumber;
  const checkOutTime = checkOutInput.valueAsNumber;
  if (!Number.isFinite(checkInTime) || !Number.isFinite(checkOutTime) || checkOutTime <= checkInTime) {
    if (summary) summary.textContent = 'Check-out must be after check-in.';
    return null;
  }

  const nights = Math.round((checkOutTime - checkInTime) / 86400000);
  if (summary) summary.textContent = `Stay length: ${nights} night${nights === 1 ? '' : 's'}.`;
  return nights;
}

function initializeDateInputs() {
  const checkInInput = document.getElementById('checkInDate');
  const checkOutInput = document.getElementById('checkOutDate');
  if (!checkInInput || !checkOutInput) return;

  const today = new Date();
  checkInInput.min = formatLocalDate(today);
  if (!checkInInput.value) checkInInput.value = formatLocalDate(today);
  if (!checkOutInput.value) {
    checkOutInput.value = new Date(checkInInput.valueAsNumber + 86400000).toISOString().slice(0, 10);
  }
  calculateNights();
}

async function handleCheckIn(e) {
  e.preventDefault();
  if (!db) return alert('Supabase is not configured.');

  const guestName = document.getElementById('guestName').value.trim();
  const phone = document.getElementById('guestPhone').value.trim();
  const roomNumber = document.getElementById('roomSelect').value;
  const checkInDate = document.getElementById('checkInDate').value;
  const checkOutDate = document.getElementById('checkOutDate').value;
  const nights = calculateNights();

  if (!guestName || !phone || !roomNumber) return alert('Please enter the guest name and phone number, and select a room.');
  if (!checkInDate || !checkOutDate || !Number.isInteger(nights) || nights < 1) {
    return alert('Please select a check-in date and a check-out date after check-in.');
  }

  const roomObj = rooms.find(r => String(r.room_number ?? r.number ?? '') === roomNumber);
  const totalAmount = nights * (roomObj && Number(roomObj.rate) > 0 ? Number(roomObj.rate) : 250);

  // Insert booking
  const { error: bErr } = await db.from('bookings').insert([{
    guest_name: guestName,
    phone: phone,
    room_number: roomNumber,
    check_in_date: checkInDate,
    check_out_date: checkOutDate,
    nights: nights,
    total_amount: totalAmount,
    booking_status: 'pending',
    payment_status: 'pending'
  }]);

  if (bErr) return alert('Error: ' + bErr.message);

  // Mark room occupied
  await db.from('rooms').update({ status: 'occupied' }).eq('room_number', roomNumber);
  
  e.target.reset();
  initializeDateInputs();
  loadPMSData();
}

async function approveBooking(bookingId) {
  if (!db) return alert('Supabase is not configured.');
  const { error } = await db.from('bookings').update({ booking_status: 'approved' }).eq('id', bookingId);
  if (error) alert(error.message);
  else loadPMSData();
}

async function markAsPaid(bookingId) {
  if (!db) return alert('Supabase is not configured.');
  const { error } = await db.from('bookings').update({ payment_status: 'paid' }).eq('id', bookingId);
  if (error) alert(error.message);
  else loadPMSData();
}

async function deleteBooking(bookingId, roomNumber) {
  if (!db) return alert('Supabase is not configured.');
  if (!confirm('Are you sure you want to delete this booking and free the room?')) return;

  const { error } = await db.from('bookings').delete().eq('id', bookingId);
  if (!error) {
    await db.from('rooms').update({ status: 'clean' }).eq('room_number', roomNumber);
    loadPMSData();
  } else {
    alert(error.message);
  }
}

async function checkoutRoom(roomNumber) {
  if (!db) return alert('Supabase is not configured.');
  const { error } = await db.from('rooms').update({ status: 'dirty' }).eq('room_number', roomNumber);
  if (error) alert(error.message);
  else loadPMSData();
}

async function markRoomClean(roomNumber) {
  if (!db) return alert('Supabase is not configured.');
  const { error } = await db.from('rooms').update({ status: 'clean' }).eq('room_number', roomNumber);
  if (error) alert(error.message);
  else loadPMSData();
}

function exportBookingsCSV() {
  if (!Array.isArray(bookings) || bookings.length === 0) {
    alert('No booking records available to export.');
    return;
  }

  const headers = [
    'Booking ID',
    'Guest Name',
    'Phone',
    'Room Number',
    'Check-In Date',
    'Check-Out Date',
    'Nights',
    'Total Amount (GHS)',
    'Booking Status',
    'Payment Status',
    'Created At'
  ];

  function csvValue(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  const rows = bookings.map(booking => [
    booking.id,
    booking.guest_name,
    booking.phone,
    booking.room_number,
    booking.check_in_date,
    booking.check_out_date,
    booking.nights || 1,
    booking.total_amount || 0,
    booking.booking_status || 'pending',
    booking.payment_status || 'pending',
    booking.created_at || ''
  ].map(csvValue));

  const csvContent = '\uFEFF' + [
    headers.map(csvValue).join(','),
    ...rows.map(row => row.join(','))
  ].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `hotel_revenue_report_${dateStr}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Utility to prevent XSS
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttribute(str) {
  return escapeHtml(str).replace(/`/g, '&#096;');
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  initializeDateInputs();
  checkAuthSession();
});