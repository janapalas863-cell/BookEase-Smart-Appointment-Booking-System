const API = '/api';
const tokenKey = 'bookease_token';
const userKey = 'bookease_user';
const indiaMarketPriceFactor = 0.5;
const currencyState = { code: 'USD', rate: 1, isIndia: false };
let currencyReady;

function currentUser() {
  try {
    return JSON.parse(localStorage.getItem(userKey) || 'null');
  } catch {
    return null;
  }
}

async function api(path, options = {}) {
  const isMultipart = options.body instanceof FormData;
  const headers = { ...(options.body && !isMultipart ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  const token = localStorage.getItem(tokenKey);
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(userKey);
    }
    throw new Error(data.message || 'The request could not be completed.');
  }
  return data;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatPrice(usdAmount) {
  const regionalFactor = currencyState.code === 'INR' ? indiaMarketPriceFactor : 1;
  const amount = Number(usdAmount) * currencyState.rate * regionalFactor;
  return new Intl.NumberFormat(undefined, {
    style: 'currency', currency: currencyState.code,
    maximumFractionDigits: currencyState.code === 'INR' ? 0 : 2
  }).format(amount);
}

function formatServicePrice(service) {
  if (currencyState.isIndia && service.price_min_inr != null && service.price_max_inr != null) {
    const formatRupees = (amount) => new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: 'INR', maximumFractionDigits: 0
    }).format(Number(amount));
    const minimum = Number(service.price_min_inr);
    const maximum = Number(service.price_max_inr);
    return minimum === maximum
      ? formatRupees(minimum)
      : `${formatRupees(minimum)}–${formatRupees(maximum)}`;
  }
  return formatPrice(service.price);
}

async function initializeCurrency() {
  let isIndia = /^en-IN$/i.test(navigator.language || '') ||
    Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Kolkata';
  try {
    const locationResponse = await fetch('https://ipapi.co/json/');
    if (locationResponse.ok) {
      const location = await locationResponse.json();
      if (typeof location.country_code === 'string') isIndia = location.country_code === 'IN';
    }
  } catch {}
  if (!isIndia) return;
  currencyState.isIndia = true;

  let rate = 0;
  try {
    const cachedRate = JSON.parse(localStorage.getItem('bookease_usd_inr_rate') || 'null');
    if (cachedRate && Date.now() - cachedRate.savedAt < 7 * 24 * 60 * 60 * 1000) {
      rate = Number(cachedRate.rate);
    }
  } catch {}
  try {
    const rateResponse = await fetch('https://open.er-api.com/v6/latest/USD');
    if (rateResponse.ok) {
      const exchange = await rateResponse.json();
      if (exchange.result === 'success' && Number(exchange.rates?.INR) > 0) {
        rate = Number(exchange.rates.INR);
        localStorage.setItem('bookease_usd_inr_rate', JSON.stringify({ rate, savedAt: Date.now() }));
      }
    }
  } catch {}
  if (rate > 0) {
    currencyState.code = 'INR';
    currencyState.rate = rate;
  }
  const label = document.querySelector('[data-currency-label]');
  if (label) label.textContent = currencyState.isIndia ? 'India prices shown in INR' : `Prices shown in ${currencyState.code}`;
}

function initializeAuth() {
  const dialog = document.querySelector('#auth-dialog');
  if (!dialog) return;
  const form = dialog.querySelector('#auth-form');
  const nameField = dialog.querySelector('#name-field');
  const toggle = dialog.querySelector('#auth-toggle');
  const message = form.querySelector('.form-message');
  let registering = false;

  document.querySelectorAll('.auth-open').forEach((button) => button.addEventListener('click', () => dialog.showModal()));
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  toggle.addEventListener('click', () => {
    registering = !registering;
    nameField.classList.toggle('hidden', !registering);
    nameField.querySelector('input').required = registering;
    form.querySelector('[name="password"]').autocomplete = registering ? 'new-password' : 'current-password';
    dialog.querySelector('#auth-title').textContent = registering ? 'Create account' : 'Sign in';
    toggle.textContent = registering ? 'Already a member? Sign in' : 'New to BookEase? Create an account';
    message.textContent = '';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      if (registering) {
        await api('/auth/register', { method: 'POST', body: JSON.stringify(values) });
        registering = false;
        nameField.classList.add('hidden');
        nameField.querySelector('input').required = false;
        dialog.querySelector('#auth-title').textContent = 'Sign in';
        toggle.textContent = 'New to BookEase? Create an account';
        message.textContent = 'Account created. Please sign in.';
        form.querySelector('[name="password"]').value = '';
        return;
      }
      const result = await api('/auth/login', { method: 'POST', body: JSON.stringify(values) });
      localStorage.setItem(tokenKey, result.token);
      localStorage.setItem(userKey, JSON.stringify(result.user));
      dialog.close();
      if (document.body.dataset.page === 'booking') {
        document.querySelector('#confirm-booking').disabled = !document.querySelector('.slot.selected');
      } else if (document.body.dataset.page === 'dashboard') {
        window.location.reload();
      }
    } catch (error) {
      message.textContent = error.message;
    }
  });
}

async function loadServices() {
  const container = document.querySelector('#service-list');
  if (!container) return;
  // Match photos by treatment name so a reordered menu still feels considered.
  const treatmentPhotography = [
    { match: /beard|barber/i, image: 'photo-1503951914875-452162b0f3f1', alt: 'A barber at work in a neighborhood shop' },
    { match: /facial|skin/i, image: 'photo-1570172619644-dfd03ed5d881', alt: 'A quiet facial treatment in progress' },
    { match: /spa|massage|relax/i, image: 'photo-1540555700478-4be289fbecef', alt: 'A calm spa space prepared for a treatment' },
    { match: /men.*boys|boys.*men/i, image: 'photo-1621605815971-fbc98d665033', alt: 'A man getting a clean, modern haircut in a barbershop' },
    { match: /girls?.*haircut/i, image: 'photo-1522337360788-8b13dee7a37e', alt: 'A woman having her hair styled at the salon' },
    { match: /hair|cut|style/i, image: 'photo-1522337360788-8b13dee7a37e', alt: 'A stylist caring for a client’s hair' }
  ];
  try {
    await currencyReady;
    const services = await api('/services');
    if (!services.length) {
      container.innerHTML = '<p class="muted">No services are listed yet. Please check back soon.</p>';
      return;
    }
    container.innerHTML = services.map((service, index) => {
      const visual = treatmentPhotography.find(({ match }) => match.test(service.title)) || treatmentPhotography[3];
      const imageUrl = `https://images.unsplash.com/${visual.image}?auto=format&fit=crop&w=720&q=80`;
      return `
        <article class="service-card">
          <div class="service-card__photo service-card__photo--${index % 4 + 1}">
            <img src="${imageUrl}" alt="${visual.alt}" loading="lazy" decoding="async">
            <span class="service-card__number">${String(index + 1).padStart(2, '0')}</span>
          </div>
          <div class="service-card__body">
            <p class="service-card__category">${escapeHtml(service.provider_specialty || 'A BookEase favourite')}</p>
            <h3>${escapeHtml(service.title)}</h3>
            <p class="service-card__description">${escapeHtml(service.description || 'A thoughtful service, tailored to you.')}</p>
            <div class="service-card__byline"><span>With ${escapeHtml(service.provider_name)}</span><span>${Number(service.duration_minutes)} min</span></div>
            <div class="service-meta">
              <div class="service-card__price"><span>Make it yours</span><strong>${formatServicePrice(service)}</strong></div>
              <a class="button service-card__book" href="/booking.html?service_id=${encodeURIComponent(service.id)}">Choose a time <span aria-hidden="true">↗</span></a>
            </div>
            <p class="service-rating">${Number(service.average_rating) ? `★ ${Number(service.average_rating).toFixed(1)}` : 'A fresh favourite'} <span>· ${Number(service.review_count)} notes</span></p>
          </div>
        </article>`;
    }).join('');
  } catch (error) {
    container.innerHTML = `<p class="form-message">${escapeHtml(error.message)}</p>`;
  }
}

async function loadStylists() {
  const container = document.querySelector('#stylist-list');
  if (!container) return;
  try {
    const stylists = await api('/profile/stylists');
    if (!stylists.length) {
      container.innerHTML = '<p class="muted">Stylist profiles will appear here as services are added.</p>';
      return;
    }
    container.innerHTML = stylists.map((stylist) => `
      <article class="stylist-profile">
        ${stylist.photo_url ? `<img src="${escapeHtml(stylist.photo_url)}" alt="${escapeHtml(stylist.name)}" loading="lazy">` : '<span class="stylist-monogram" aria-hidden="true">✦</span>'}
        <div><h3>${escapeHtml(stylist.name)}</h3>
          <p>${escapeHtml(stylist.specialty || 'BookEase stylist')}${stylist.city ? ` · ${escapeHtml(stylist.city)}` : ''}</p>
          <p class="stylist-rating">${Number(stylist.average_rating) ? `★ ${Number(stylist.average_rating).toFixed(1)}` : 'New to BookEase'} · ${Number(stylist.review_count)} reviews</p>
          ${stylist.bio ? `<p>${escapeHtml(stylist.bio)}</p>` : ''}
        </div>
      </article>`).join('');
  } catch (error) {
    container.innerHTML = `<p class="form-message">${escapeHtml(error.message)}</p>`;
  }
}

async function loadLatestReviews() {
  const container = document.querySelector('#review-list');
  if (!container) return;
  try {
    const reviews = await api('/reviews/latest');
    container.innerHTML = reviews.length ? reviews.map((review) => `
      <article class="public-review">
        <strong>${'★'.repeat(Number(review.rating))}${'☆'.repeat(5 - Number(review.rating))}</strong>
        <p>${escapeHtml(review.comment || 'A lovely appointment.')}</p>
        <span>${escapeHtml(review.customer_name)} · ${escapeHtml(review.service_title)} with ${escapeHtml(review.provider_name)}</span>
      </article>`).join('') : '<p class="muted">Be the first to share an appointment review.</p>';
  } catch (error) {
    container.innerHTML = `<p class="form-message">${escapeHtml(error.message)}</p>`;
  }
}

async function loadOffers(containerSelector = '#offer-list') {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  try {
    const offers = await api('/offers');
    container.innerHTML = offers.length ? offers.map((offer) => `
      <article class="offer-item"><span class="offer-code">${escapeHtml(offer.code)}</span>
        <div><h3>${escapeHtml(offer.title)}</h3><p>${escapeHtml(offer.description)}</p></div>
      </article>`).join('') : '<p class="muted">There are no active offers right now.</p>';
  } catch (error) {
    container.innerHTML = `<p class="form-message">${escapeHtml(error.message)}</p>`;
  }
}

async function initializeBooking() {
  const dateInput = document.querySelector('#booking-date');
  if (!dateInput) return;
  const serviceId = new URLSearchParams(window.location.search).get('service_id');
  const slotsContainer = document.querySelector('#slot-list');
  const confirmButton = document.querySelector('#confirm-booking');
  const message = document.querySelector('#booking-message');
  let selectedSlot = null;
  await currencyReady;
  const today = new Date();
  dateInput.min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (!serviceId || !/^\d+$/.test(serviceId)) {
    message.textContent = 'A valid service is required. Please return to the service catalog.';
    dateInput.disabled = true;
    return;
  }

  try {
    const services = await api('/services');
    const service = services.find((entry) => String(entry.id) === serviceId);
    if (!service) throw new Error('Service not found.');
    document.querySelector('#booking-title').textContent = service.title;
    document.querySelector('#booking-description').textContent =
      `${service.duration_minutes} minutes · ${formatServicePrice(service)} · with ${service.provider_name}`;
  } catch (error) {
    message.textContent = error.message;
    dateInput.disabled = true;
    return;
  }

  dateInput.addEventListener('change', async () => {
    selectedSlot = null;
    confirmButton.disabled = true;
    message.textContent = '';
    if (!dateInput.value) return;
    slotsContainer.innerHTML = '<p class="muted">Loading time slots…</p>';
    try {
      const slots = await api(`/bookings/available-slots?service_id=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(dateInput.value)}`);
      if (!slots.length) {
        slotsContainer.innerHTML = '<p class="muted">No appointments are available on this date.</p>';
        return;
      }
      slotsContainer.innerHTML = slots.map((slot) => `
        <button type="button" class="slot" data-start="${escapeHtml(slot.start_time)}" ${slot.available ? '' : 'disabled'}>
          ${escapeHtml(slot.start_time.slice(0, 5))}${slot.available ? '' : ' · Booked'}
        </button>`).join('');
      slotsContainer.querySelectorAll('.slot:not(:disabled)').forEach((button) => {
        button.addEventListener('click', () => {
          slotsContainer.querySelectorAll('.slot').forEach((slot) => slot.classList.remove('selected'));
          button.classList.add('selected');
          selectedSlot = button.dataset.start;
          confirmButton.disabled = false;
        });
      });
    } catch (error) {
      slotsContainer.innerHTML = `<p class="form-message">${escapeHtml(error.message)}</p>`;
    }
  });

  confirmButton.addEventListener('click', async () => {
    if (!localStorage.getItem(tokenKey)) {
      document.querySelector('#auth-dialog').showModal();
      message.textContent = 'Sign in or create an account to book this appointment.';
      return;
    }
    if (!selectedSlot) return;
    confirmButton.disabled = true;
    message.textContent = '';
    try {
      await api('/bookings', {
        method: 'POST',
        body: JSON.stringify({ service_id: Number(serviceId), booking_date: dateInput.value, start_time: selectedSlot })
      });
      message.textContent = 'Your appointment request is booked.';
      window.location.href = '/dashboard.html';
    } catch (error) {
      message.textContent = error.message;
      confirmButton.disabled = false;
      dateInput.dispatchEvent(new Event('change'));
    }
  });
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

async function initializeDashboard() {
  const list = document.querySelector('#dashboard-bookings');
  if (!list) return;
  const user = currentUser();
  if (!user || !localStorage.getItem(tokenKey)) {
    document.querySelector('#dashboard-greeting').textContent = 'Sign in to see your bookings';
    list.innerHTML = '<button class="button auth-open" type="button">Sign in</button>';
    list.querySelector('.auth-open').addEventListener('click', () => document.querySelector('#auth-dialog').showModal());
    return;
  }

  document.querySelector('#dashboard-greeting').textContent = `Hello, ${user.name}`;
  const profileSection = document.querySelector('#profile-section');
  profileSection.classList.remove('hidden');
  const profileForm = document.querySelector('#profile-form');
  const profileMessage = document.querySelector('#profile-message');
  const photoInput = document.querySelector('#profile-photo-file');
  const photoPreview = document.querySelector('#profile-photo-preview');
  let previewObjectUrl = null;
  let savedPhotoUrl = '';
  if (user.role === 'provider') document.querySelector('#stylist-profile-fields').classList.remove('hidden');
  try {
    const profile = await api('/profile/me');
    for (const field of profileForm.elements) {
      if (field.name && profile[field.name] != null) field.value = profile[field.name];
    }
    if (profile.photo_url) {
      savedPhotoUrl = profile.photo_url;
      photoPreview.src = savedPhotoUrl;
      photoPreview.classList.remove('hidden');
    }
  } catch (error) {
    profileMessage.textContent = error.message;
  }
  photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
    if (!file) {
      photoPreview.classList.toggle('hidden', !savedPhotoUrl);
      if (savedPhotoUrl) photoPreview.src = savedPhotoUrl;
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      photoInput.value = '';
      photoPreview.classList.toggle('hidden', !savedPhotoUrl);
      if (savedPhotoUrl) photoPreview.src = savedPhotoUrl;
      profileMessage.textContent = 'Choose a JPEG, PNG, or WebP image that is 5 MB or smaller.';
      return;
    }
    previewObjectUrl = URL.createObjectURL(file);
    photoPreview.src = previewObjectUrl;
    photoPreview.classList.remove('hidden');
    profileMessage.textContent = '';
  });
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    profileMessage.textContent = '';
    const photoFile = photoInput.files[0];
    const values = Object.fromEntries(
      [...new FormData(profileForm).entries()].filter(([key]) => key !== 'photo_file')
    );
    try {
      const result = await api('/profile/me', { method: 'PUT', body: JSON.stringify(values) });
      const updatedUser = { ...user, name: result.name };
      localStorage.setItem(userKey, JSON.stringify(updatedUser));
      document.querySelector('#dashboard-greeting').textContent = `Hello, ${result.name}`;
      if (photoFile) {
        const uploadData = new FormData();
        uploadData.append('photo', photoFile);
        const uploaded = await api('/profile/me/photo', { method: 'POST', body: uploadData });
        savedPhotoUrl = uploaded.photo_url;
        photoPreview.src = savedPhotoUrl;
        photoPreview.classList.remove('hidden');
        photoInput.value = '';
        if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
        profileMessage.textContent = `${result.message} ${uploaded.message}`;
      } else {
        profileMessage.textContent = result.message;
      }
    } catch (error) {
      profileMessage.textContent = error.message;
    }
  });

  if (user.role === 'customer') {
    const loyaltySection = document.querySelector('#loyalty-section');
    loyaltySection.classList.remove('hidden');
    loadOffers('#dashboard-offer-list');
    try {
      const loyalty = await api('/offers/loyalty/me');
      document.querySelector('#loyalty-points').textContent = String(loyalty.points);
      document.querySelector('#loyalty-detail').textContent =
        `${loyalty.completed_appointments} completed appointments · ${loyalty.next_reward_at - loyalty.completed_appointments} more to your next reward milestone`;
    } catch (error) {
      document.querySelector('#loyalty-detail').textContent = error.message;
    }
  } else {
    document.querySelector('#loyalty-section').remove();
  }
  document.querySelector('#sign-out').addEventListener('click', () => {
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(userKey);
    window.location.href = '/';
  });
  const providerTools = document.querySelector('#provider-tools');
  if (user.role === 'provider') {
    providerTools.classList.remove('hidden');
    document.querySelector('#booking-list-title').textContent = 'Your schedule';
    const scheduleDateField = document.querySelector('#schedule-date-field');
    const scheduleDate = document.querySelector('#schedule-date');
    scheduleDateField.classList.remove('hidden');
    const localToday = new Date();
    scheduleDate.value = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, '0')}-${String(localToday.getDate()).padStart(2, '0')}`;
    document.querySelector('#service-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const message = document.querySelector('#service-message');
      const values = Object.fromEntries(new FormData(form).entries());
      values.price = Number(values.price);
      values.price_min_inr = values.price_min_inr === '' ? null : Number(values.price_min_inr);
      values.price_max_inr = values.price_max_inr === '' ? null : Number(values.price_max_inr);
      values.duration_minutes = Number(values.duration_minutes);
      try {
        await api('/services', { method: 'POST', body: JSON.stringify(values) });
        form.reset();
        message.textContent = 'Service added.';
      } catch (error) {
        message.textContent = error.message;
      }
    });
    await initializeAvailability();
  } else {
    providerTools.remove();
    if (user.role === 'admin') {
      document.querySelector('#booking-list-title').textContent = 'All bookings';
      document.querySelector('#schedule-date-field').classList.remove('hidden');
      const localToday = new Date();
      document.querySelector('#schedule-date').value =
        `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, '0')}-${String(localToday.getDate()).padStart(2, '0')}`;
    } else {
      document.querySelector('#customer-booking-tabs').classList.remove('hidden');
    }
  }

  try {
    const [bookings, reviewed] = await Promise.all([
      api('/bookings/my-bookings'),
      user.role === 'customer' ? api('/reviews/mine') : Promise.resolve([])
    ]);
    const reviewedBookings = new Set(reviewed.map((review) => Number(review.booking_id)));
    const scheduleDate = document.querySelector('#schedule-date');
    const tabs = document.querySelector('#customer-booking-tabs');
    let customerFilter = 'upcoming';
    const renderBookings = () => {
      const today = new Date();
      const todayText = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      let visibleBookings = bookings;
      if (user.role === 'customer') {
        visibleBookings = bookings.filter((booking) => {
          const isUpcoming = booking.booking_date >= todayText &&
            ['pending', 'confirmed'].includes(booking.status);
          return customerFilter === 'upcoming' ? isUpcoming : !isUpcoming;
        });
      } else if (scheduleDate.value) {
        visibleBookings = bookings.filter((booking) => booking.booking_date === scheduleDate.value);
      }
      if (!visibleBookings.length) {
        const emptyMessage = user.role === 'customer'
          ? (customerFilter === 'upcoming' ? 'No upcoming bookings. Find a service to get started.' : 'No booking history yet.')
          : 'No bookings for this date.';
        list.innerHTML = `<p class="muted">${emptyMessage}</p>`;
        return;
      }
      list.innerHTML = visibleBookings.map((booking) => {
      const pending = ['pending', 'confirmed'].includes(booking.status);
      const person = user.role === 'provider' || user.role === 'admin'
        ? `Client: ${escapeHtml(booking.customer_name)}`
        : `With ${escapeHtml(booking.provider_name)}`;
      return `<article class="booking-item">
        <div><h3>${escapeHtml(booking.service_title)}</h3>
          <p>${formatDate(booking.booking_date)} · ${escapeHtml(booking.start_time.slice(0, 5))}–${escapeHtml(booking.end_time.slice(0, 5))} · ${person}</p>
        </div>
        <div class="booking-actions"><span class="status">${escapeHtml(booking.status)}</span>
          ${user.role === 'customer' && pending ? `<button class="small-button" data-id="${booking.id}" data-status="cancelled">Cancel</button>` : ''}
          ${user.role !== 'customer' && booking.status === 'pending' ? `<button class="small-button" data-id="${booking.id}" data-status="confirmed">Confirm</button>` : ''}
          ${user.role !== 'customer' && booking.status === 'confirmed' ? `<button class="small-button" data-id="${booking.id}" data-status="completed">Complete</button>` : ''}
          ${user.role !== 'customer' && pending ? `<button class="small-button" data-id="${booking.id}" data-status="cancelled">Cancel</button>` : ''}
          ${user.role === 'customer' && booking.status === 'completed' && !reviewedBookings.has(Number(booking.id)) ? `
            <form class="review-form" data-booking-id="${booking.id}">
              <label>Rating<select name="rating" required><option value="5">5 stars</option><option value="4">4 stars</option><option value="3">3 stars</option><option value="2">2 stars</option><option value="1">1 star</option></select></label>
              <label>Review<textarea name="comment" rows="2" maxlength="1000" placeholder="How was your appointment?"></textarea></label>
              <button class="small-button" type="submit">Share review</button><span class="form-message" role="status"></span>
            </form>` : ''}
        </div>
      </article>`;
      }).join('');
      list.querySelectorAll('[data-id]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api(`/bookings/${button.dataset.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: button.dataset.status })
        });
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        window.alert(error.message);
      }
      }));
      list.querySelectorAll('.review-form').forEach((form) => form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const message = form.querySelector('.form-message');
        const values = Object.fromEntries(new FormData(form).entries());
        try {
          await api('/reviews', {
            method: 'POST',
            body: JSON.stringify({ booking_id: Number(form.dataset.bookingId), rating: Number(values.rating), comment: values.comment })
          });
          reviewedBookings.add(Number(form.dataset.bookingId));
          form.outerHTML = '<p class="muted">Review submitted. Thank you!</p>';
        } catch (error) {
          message.textContent = error.message;
        }
      }));
    };
    if (scheduleDate) scheduleDate.addEventListener('change', renderBookings);
    if (tabs) {
      tabs.querySelectorAll('.booking-tab').forEach((button) => button.addEventListener('click', () => {
        customerFilter = button.dataset.filter;
        tabs.querySelectorAll('.booking-tab').forEach((tab) => {
          const selected = tab === button;
          tab.classList.toggle('active', selected);
          tab.setAttribute('aria-selected', String(selected));
        });
        renderBookings();
      }));
    }
    renderBookings();
  } catch (error) {
    list.innerHTML = `<p class="form-message">${escapeHtml(error.message)}</p>`;
  }
}

async function initializeAvailability() {
  const form = document.querySelector('#availability-form');
  const container = document.querySelector('#availability-days');
  const message = document.querySelector('#availability-message');
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  container.innerHTML = days.map((day) => `
    <div class="availability-day-group" data-day="${day}">
      <div class="availability-day-header">
        <label class="availability-day"><input type="checkbox" name="enabled"> ${day}</label>
        <button class="small-button add-availability-window" type="button" disabled>Add hours</button>
      </div>
      <div class="availability-windows"></div>
    </div>`).join('');

  const addWindow = (group, start = '09:00', end = '17:00') => {
    const windows = group.querySelector('.availability-windows');
    if (windows.children.length >= 6) return;
    const row = document.createElement('div');
    row.className = 'availability-row';
    row.innerHTML = `
      <label>From<input class="availability-time" name="start_time" type="time" value="${escapeHtml(start)}" required></label>
      <label>Until<input class="availability-time" name="end_time" type="time" value="${escapeHtml(end)}" required></label>
      <button class="small-button remove-availability-window" type="button">Remove</button>`;
    row.querySelector('.remove-availability-window').addEventListener('click', () => {
      row.remove();
      if (!windows.children.length) {
        group.querySelector('[name="enabled"]').checked = false;
        group.querySelector('.add-availability-window').disabled = true;
      }
      group.querySelector('.add-availability-window').disabled = windows.children.length >= 6;
    });
    windows.append(row);
    group.querySelector('.add-availability-window').disabled = windows.children.length >= 6;
  };

  container.querySelectorAll('.availability-day-group').forEach((group) => {
    const enabled = group.querySelector('[name="enabled"]');
    enabled.addEventListener('change', () => {
      group.querySelector('.add-availability-window').disabled = !enabled.checked;
      if (enabled.checked && !group.querySelector('.availability-windows').children.length) {
        addWindow(group);
      }
    });
    group.querySelector('.add-availability-window').addEventListener('click', () => addWindow(group));
  });

  try {
    const windows = await api('/availability');
    for (const window of windows) {
      const group = container.querySelector(`[data-day="${window.day_of_week}"]`);
      if (!group) continue;
      group.querySelector('[name="enabled"]').checked = true;
      group.querySelector('.add-availability-window').disabled = false;
      addWindow(group, window.start_time.slice(0, 5), window.end_time.slice(0, 5));
    }
  } catch (error) {
    message.textContent = error.message;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';
    const windows = [...container.querySelectorAll('.availability-day-group')]
      .flatMap((group) => [...group.querySelectorAll('.availability-row')].map((row) => ({
        day_of_week: group.dataset.day,
        start_time: row.querySelector('[name="start_time"]').value,
        end_time: row.querySelector('[name="end_time"]').value
      })));
    try {
      const result = await api('/availability', {
        method: 'PUT',
        body: JSON.stringify({ windows })
      });
      message.textContent = `Weekly availability saved (${result.windows} working days).`;
    } catch (error) {
      message.textContent = error.message;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });
  initializeAuth();
  currencyReady = initializeCurrency();
  if (document.body.dataset.page === 'catalog') {
    loadServices();
    loadStylists();
    loadLatestReviews();
    loadOffers();
  }
  if (document.body.dataset.page === 'booking') initializeBooking();
  if (document.body.dataset.page === 'dashboard') initializeDashboard();
});
