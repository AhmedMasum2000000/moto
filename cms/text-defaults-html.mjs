// Fixed page-HTML texts that carry data-cms-text / data-cms-placeholder keys.
// Every value equals the text the page showed before it became editable, so nothing
// changes for customers until staff edit it. Fields go into the existing section the
// element lives in; texts that repeat on several pages go into 'site-common'.
const field = (id, label, value) => ({id, kind: 'text', label, value});

export const sections = [
  {
    id: 'site-common', page: 'index', name: 'Shared texts · every page',
    hint: 'Fixed texts that repeat on every page: the phone action bar, the cart drawer, the search box and the big footer word.',
    fields: [
      field('actionbar-call', 'Phone action bar · call', 'Call'),
      field('actionbar-call-sub', 'Phone action bar · call, small line', 'Talk now'),
      field('actionbar-wa', 'Phone action bar · WhatsApp', 'WhatsApp'),
      field('actionbar-wa-sub', 'Phone action bar · WhatsApp, small line', 'Send a note'),
      field('actionbar-book', 'Phone action bar · book', 'Book'),
      field('actionbar-book-sub', 'Phone action bar · book, small line', 'Free slot'),
      field('cart-title', 'Cart · heading', 'Your cart'),
      field('cart-close', 'Cart · close button', 'Close ✕'),
      field('cart-total-label', 'Cart · total label', 'Total'),
      field('search-placeholder', 'Search box · hint inside the box', 'Search parts, oil, tyres, services…'),
      field('search-hint', 'Search box · suggestion line', 'Try “brake pads”, “Castrol”, “helmet”, “wash”'),
      field('wordmark-store', 'Big footer word · home, shop and custom pages', 'MOTO MARKET'),
      field('wordmark-book', 'Big footer word · booking page', 'BOOK IT'),
      field('wordmark-journal', 'Big footer word · journal', 'JOURNAL'),
    ],
  },
  {
    id: 'index-fitment', page: 'index', name: 'Homepage hero & ride tools',
    fields: [
      field('fitment-step1', 'Ride finder · step 1', 'Two wheels or four?'),
      field('fitment-step2', 'Ride finder · step 2', 'Pick the badge'),
      field('fitment-step3', 'Ride finder · step 3', 'Lock in your model'),
      field('fitment-bike', 'Ride finder · bike tile', 'Bike'),
      field('fitment-car', 'Ride finder · car tile', 'Car'),
      field('fitment-or', 'Ride finder · divider', 'or pick it in three taps'),
      field('fitment-quick-label', 'Ride finder · quick picks label', 'Quick picks'),
      field('fitment-remind-lead', 'Service reminder · question start', 'Nudge me to service my'),
      field('fitment-remind-in', 'Service reminder · question end', 'in'),
      field('fitment-remind-1', 'Service reminder · 1 month', '1 month'),
      field('fitment-remind-2', 'Service reminder · 2 months', '2 months'),
      field('fitment-remind-3', 'Service reminder · 3 months', '3 months'),
      field('fitment-remind-date', 'Service reminder · date label', 'Reminder on'),
      field('fitment-remind-google', 'Service reminder · Google button', 'Google Calendar'),
      field('fitment-remind-ics', 'Service reminder · Apple/Outlook button', 'Apple / Outlook (.ics)'),
      field('fitment-change', 'Ride finder · change ride', 'Change ride'),
      field('fitment-forget', 'Ride finder · forget ride', 'Forget it'),
      field('fitment-trust', 'Ride finder · promise line', 'Fit confirmed at the counter — before you pay'),
    ],
  },
  {
    id: 'index-dealer', page: 'index', name: 'Official dealer',
    fields: [
      field('index-dealer-parts-label', 'Spare parts brands · label', 'Spare parts'),
    ],
  },
  {
    id: 'shop-section-1', page: 'shop', name: 'Shop',
    fields: [
      field('shop-empty', 'Empty category · text before the phone number', 'Nothing in this category right now. Call'),
      field('shop-empty-after', 'Empty category · text after the phone number', '— if it exists, we can get it.'),
      field('shop-kits-label', 'Kits · small label', 'Complete the job'),
      field('shop-kits-title', 'Kits · heading', 'Kits riders buy together'),
      field('shop-kits-intro', 'Kits · side note', 'Add a whole job in one tap'),
      field('shop-partners-label', 'Brand partners · small label', 'Brand partners'),
      field('shop-partners-title', 'Brand partners · heading', 'The names on our shelf'),
      field('shop-note', 'Pricing note · text before the phone number', "Prices are indicative and include VAT. Fitting is charged separately and quoted before work starts. Don't see your model? Call"),
      field('shop-note-after', 'Pricing note · text after the phone number', '— most parts are in the back or here within 48 hours.'),
    ],
  },
  {
    id: 'shop-finder', page: 'shop', name: 'Bike & car model search',
    fields: [
      field('finder-bike-title', 'Bike tile · title', 'BIKE'),
      field('finder-bike-sub', 'Bike tile · line', 'Two wheels. Your way.'),
      field('finder-car-title', 'Car tile · title', 'CAR'),
      field('finder-car-sub', 'Car tile · line', 'Four wheels. Perfect fit.'),
      field('finder-model-label', 'Model box · label', 'YOUR MODEL'),
      field('finder-clear-button', 'Model box · clear button', 'Clear'),
    ],
  },
  {
    id: 'book-section-2', page: 'book', name: 'Extra website text',
    fields: [
      field('book-name-placeholder', 'Name box · hint', 'Full name'),
      field('book-vehicle-placeholder', 'Vehicle box · hint', 'e.g. Yamaha FZS V3, 2022'),
      field('book-notes-placeholder', 'Notes box · hint', 'Noise when I pull the clutch, worse when cold…'),
    ],
  },
];
