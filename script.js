document.addEventListener('DOMContentLoaded', () => {
    const slotsContainer  = document.getElementById('slots');
    const bookingForm     = document.getElementById('bookingForm');

    if (!slotsContainer || !bookingForm) return;

    const selectedSlotInput  = document.getElementById('selectedSlot');
    const customerNameInput  = document.getElementById('customerName');
    const bookingDateInput   = document.getElementById('bookingDate');
    const haircutStyleInput  = document.getElementById('haircutStyle');
    const styleOptions       = document.querySelectorAll('.style-option');
    const bookingMessage     = document.getElementById('bookingMessage');
    const bookingButton      = document.getElementById('bookButton');
    const refreshButton      = document.getElementById('refreshButton');
    const slotStatus         = document.getElementById('slotStatus');

    let selectedSlotId = null;
    let currentSlots   = [];

    const PRICE_PER_PERSON = 150; // ₹ per haircut

    // ── Helpers ───────────────────────────────────────────────
    const updateMessage = (message, type = '') => {
        bookingMessage.textContent = message;
        bookingMessage.className   = `booking-message ${type}`.trim();
    };

    const syncStyleSelection = () => {
        styleOptions.forEach(opt =>
            opt.classList.toggle('active', opt.dataset.style === haircutStyleInput.value)
        );
    };

    const updateSelection = (slotId) => {
        selectedSlotId = slotId;
        const slot = currentSlots.find(s => s.id === slotId);
        selectedSlotInput.value  = slot ? slot.time : '';
        bookingButton.disabled   = !slot;

        slotsContainer.querySelectorAll('.slot-card').forEach(btn =>
            btn.classList.toggle('selected', Number(btn.dataset.id) === slotId)
        );
    };

    const setDefaultDate = () => {
        const today     = new Date();
        const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
            .toISOString()
            .split('T')[0];

        bookingDateInput.min = localDate;
        if (!bookingDateInput.value) bookingDateInput.value = localDate;
    };

    // ── Render slots ──────────────────────────────────────────
    const renderSlots = (slots) => {
        currentSlots         = slots;
        slotsContainer.innerHTML = '';

        const available = slots.filter(s => s.available).length;
        slotStatus.textContent = `${available} of ${slots.length} slots available`;

        slots.forEach(slot => {
            const btn   = document.createElement('button');
            btn.type    = 'button';
            btn.dataset.id  = String(slot.id);
            btn.className   = `slot-card${slot.available ? '' : ' unavailable'}`;
            btn.disabled    = !slot.available;
            btn.innerHTML   = `
                <span class="slot-time">${slot.time}</span>
                <span class="slot-meta">${slot.available ? 'Available to book' : 'Already booked'}</span>
                <span class="slot-price">₹${PRICE_PER_PERSON}</span>
            `;

            if (slot.available) {
                btn.addEventListener('click', () => {
                    updateSelection(slot.id);
                    updateMessage('');
                });
            }

            slotsContainer.appendChild(btn);
        });

        const stillAvailable = slots.some(s => s.id === selectedSlotId && s.available);
        stillAvailable ? updateSelection(selectedSlotId) : updateSelection(null);
    };

    // ── Load slots for selected date ──────────────────────────
    const loadSlots = async () => {
        const date = bookingDateInput.value;
        if (!date) return;

        slotStatus.textContent = 'Loading schedule...';

        try {
            const res   = await fetch(`/api/slots?date=${date}`);
            if (!res.ok) throw new Error('Unable to load slots right now.');
            const slots = await res.json();
            renderSlots(slots);
        } catch (err) {
            slotStatus.textContent = 'Could not load slots. Please make sure the server is running.';
            updateMessage(err.message, 'error');
        }
    };

    // ── Form submit ───────────────────────────────────────────
    bookingForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (!selectedSlotId) {
            updateMessage('Please choose an available slot first.', 'error');
            return;
        }

        const customerName = customerNameInput.value.trim();
        const bookingDate  = bookingDateInput.value.trim();
        const haircutStyle = haircutStyleInput.value.trim();

        if (!customerName) { updateMessage('Please enter your name.',        'error'); return; }
        if (!bookingDate)  { updateMessage('Please choose a booking date.',  'error'); return; }
        if (!haircutStyle) { updateMessage('Please choose a hair style.',    'error'); return; }

        bookingButton.disabled = true;

        try {
            const res    = await fetch('/api/book', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ id: selectedSlotId, customerName, haircutStyle, bookingDate }),
            });

            const result = await res.json();

            if (!res.ok) throw new Error(result.message || 'This slot is no longer available.');

            updateMessage(result.message, 'success');
            customerNameInput.value = '';
            haircutStyleInput.value = '';
            syncStyleSelection();
            await loadSlots();
        } catch (err) {
            updateMessage(err.message, 'error');
            bookingButton.disabled = false;
        }
    });

    // ── Event listeners ───────────────────────────────────────
    styleOptions.forEach(opt =>
        opt.addEventListener('click', () => {
            haircutStyleInput.value = opt.dataset.style;
            syncStyleSelection();
            updateMessage('');
        })
    );

    haircutStyleInput.addEventListener('change', syncStyleSelection);

    // Reload slots whenever the date changes
    bookingDateInput.addEventListener('change', () => {
        updateSelection(null);
        loadSlots();
    });

    refreshButton.addEventListener('click', loadSlots);

    // ── Init ──────────────────────────────────────────────────
    setDefaultDate();
    syncStyleSelection();
    loadSlots();
});
