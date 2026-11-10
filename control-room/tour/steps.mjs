// Tour script (plan role I6). Pure data + helpers, no DOM — safe to import from node tests.
//
// Exports
//   SECTIONS                       ordered hub groups [{id, title}]
//   CHAPTERS                       [{id, title, section, route, sub?, roles, keywords, blurb, steps:[step]}]
//   STEPS                          flat list of every step (each carries .chapter)
//   ROLES / STAFF                  role lists used below
//   MICROCOPY                      mascot lines for other modules (empty states, confirms, errors, publish)
//   anchorOf(step) → 'name'        the data-tour value a step points at
//   anchorsUsed() → Set<'name'>    every anchor the script needs (tests/tour.test.mjs checks them)
//   allowed(item, opts) → bool     role / publish / phone filter for one chapter or step
//   chaptersFor(opts) → chapters   chapters visible to {role, canPublish}, each with filtered .steps (empty ones dropped)
//   stepsFor(id, opts) → steps     the filtered steps of one chapter
//   chapterById(id)
//   chapterForRoute(route, sub, {editorType}) → chapter id for "Explain this page"
//   searchChapters(query, opts) → chapters matching a search ("add subcategory" → categories)
//   minutesFor(steps) → number     duration estimate shown in the hub
//
// Step schema: {id, chapter, route, sub?, prepare?, target:'[data-tour="…"]', nth?, title ≤60,
//   body ≤280 (plain text, escaped at render), note?, placement?, roles?, publish?, phoneOnly?,
//   desktopOnly?, action?, actionLabel?}
//   prepare / action: 'openEditor:<type>:new' (demo editor, cannot save) · 'openDrawer' ·
//   'selectFirstRow' · 'chooseImage' · 'click:<anchor>' · 'click:<css selector>'. Neither ever saves.
//   nth picks the n-th match of the target (0-based) when an anchor appears more than once.
//   publish:true → only for the owner and staff allowed to publish. phoneOnly → skipped on desktop.

export const ROLES = ['owner', 'editor', 'service'];
export const STAFF = ['owner', 'editor'];
const OWNER = ['owner'];

export const SECTIONS = [
  {id: 'start', title: 'Start here'},
  {id: 'products', title: 'Products'},
  {id: 'services', title: 'Services'},
  {id: 'website', title: 'Your website'},
  {id: 'photos', title: 'Photos & files'},
  {id: 'orders', title: 'Orders & bookings'},
  {id: 'settings', title: 'Store settings'},
  {id: 'publish', title: 'Going live'}
];

export const MICROCOPY = {
  greetingTitle: "Hi, I'm Cookie Rider.",
  greetingBody: 'Want a quick look around? It takes about a minute, and you can stop any time.',
  emptyBundles: "No bundles yet. Tap + Add bundle and I'll walk you through it.",
  emptyList: "Nothing here yet. Tap + Add and I'll walk you through it.",
  deleteNote: 'Live site changes only when you publish. Version history can bring it back.',
  discardTitle: 'Discard your changes?',
  discardBody: "You haven't saved this yet. If you leave now, these edits are gone.",
  errorHeader: 'Something needs fixing',
  publishSuccess: 'Live! Customers see it now.',
  demoSave: 'Finish the tour first',
  missingTarget: "This part isn't on your screen right now.",
  phoneOnlyCard: 'This one works best on a bigger screen, but here is what it does.'
};

const T = name => `[data-tour="${name}"]`;
const ed = type => `openEditor:${type}:new`;

// s(id, anchor, title, body, extra)
const s = (id, anchor, title, body, extra = {}) => ({id, target: T(anchor), title, body, ...extra});

const RAW = [
  {
    id: 'getting-around', title: 'Getting around', section: 'start', route: 'home', roles: ROLES,
    blurb: 'The menu, search, preview and publish buttons.',
    keywords: ['menu', 'navigation', 'search', 'find', 'preview', 'publish', 'sign out', 'logout', 'start', 'basics', 'help'],
    steps: [
      s('around-menu', 'nav-home', 'Your main menu', 'This menu takes you everywhere. Each item is one part of the shop: products, services, your website, photos, orders and settings. Tap one and I will keep up.', {placement: 'right', roles: STAFF}),
      // Service staff get no website draft, so their menu is only Requests and Store settings.
      s('around-menu-service', 'nav-requests', 'Your main menu', 'Your menu has the two places you need: Requests for orders and bookings, and Store settings for your password.', {placement: 'right', roles: ['service']}),
      s('around-phone-menu', 'menu-button', 'The menu button', 'On a phone the menu hides here so you get more room. Tap it any time to open or close it.', {phoneOnly: true}),
      s('around-search', 'topbar-search', 'Search anything', "Lost? Press / or tap search and type what you want, like 'brake pads' or 'add subcategory'. I find products, pages and even the right tour chapter."),
      s('around-preview', 'topbar-preview', 'Preview first', 'See your website with your changes before customers do. Nothing goes live from the preview.', {roles: STAFF}),
      s('around-changes', 'change-count', 'Changes waiting', "This counts edits that aren't live yet. Customers keep seeing the old version until you publish.", {roles: STAFF}),
      s('around-publish', 'topbar-publish', 'Review & publish', "When you're happy, Review & publish puts everything live in one go. You see a list of every change first.", {roles: STAFF, publish: true}),
      s('around-tour', 'topbar-tour', "That's me!", "Tap me any time and I'll show you around again. Every page also has an 'Explain this page' button."),
      s('around-signout', 'sign-out', 'Sign out', "Sign out here when you're done, especially on a shared phone or computer.")
    ]
  },
  {
    id: 'home', title: 'Your home page', section: 'start', route: 'home', roles: STAFF,
    blurb: 'Counts, quick jobs, your site structure and stock warnings.',
    keywords: ['home', 'dashboard', 'overview', 'low stock', 'out of stock', 'latest changes', 'structure'],
    steps: [
      s('home-counts', 'home-counts', 'Your shop at a glance', 'Your shop at a glance: products, categories and orders that are waiting for you.'),
      s('home-tasks', 'home-tasks', 'Quick jobs', "The jobs you'll do most, one tap away. Pick one and I'll take you straight there."),
      s('home-structure', 'home-structure', 'Your website structure', 'Your homepage, top to bottom. Add a section or open the layout right from here.', {roles: STAFF}),
      s('home-lowstock', 'home-lowstock', 'Running low', 'Products running low or sold out. Tap to see them and restock in one go.', {roles: STAFF}),
      s('home-preview', 'home-preview', 'Mini preview', 'A mini view of your site. Open it to check how things look.'),
      s('home-latest', 'home-latest', 'Latest changes', 'Your latest saved changes, newest first. They stay private until someone publishes.', {roles: STAFF})
    ]
  },
  {
    id: 'products', title: 'All products', section: 'products', route: 'products', sub: 'products', roles: STAFF,
    blurb: 'Search, filter, select many, spreadsheets and Undo.',
    keywords: ['product', 'products', 'add product', 'new product', 'price', 'stock', 'filter', 'sort', 'bulk', 'select', 'move', 'csv', 'spreadsheet', 'excel', 'import', 'export', 'undo', 'delete', 'duplicate'],
    steps: [
      s('prod-add', 'add-button', 'Add a product', 'Add a new product. Only a name, category and price are needed to start. You can fill in the rest later.'),
      s('prod-search', 'list-search', 'Search the list', 'Search by name, brand, SKU or tag. Results update as you type.'),
      s('prod-filter', 'filter-bar', 'Filters', 'Narrow down by category, subcategory, brand, stock, on sale and more. Tap a chip again to clear it.'),
      s('prod-sort', 'sort', 'Sort', 'Sort by name, price, stock or what you edited last.'),
      s('prod-row', 'row-first', 'Open a product', 'Tap a product to edit it. The Visible and In stock switches on the row save for you.'),
      s('prod-actions', 'row-actions', 'More actions', 'Duplicate a similar product to save typing, or delete one. Every change can be undone.'),
      s('prod-drag', 'drag-handle', 'Change the order', 'Drag to change the order customers see. The handle appears when you pick one category in the filter, so I picked one for you.', {prepare: 'filterOneCategory'}),
      s('prod-select', 'select-toggle', 'Pick many at once', 'Tap Select, or long-press a row on a phone, to pick many products at once.'),
      s('prod-bulk', 'bulk-bar', 'Change many in one go', 'Move, hide, reprice or restock all the selected products in one go. Price changes show a preview before you apply.', {action: 'selectFirstRow', actionLabel: 'Select one for me'}),
      s('prod-export', 'io-export', 'Download a spreadsheet', 'Download all your products as a spreadsheet (CSV). It opens in Excel or Google Sheets.'),
      s('prod-import', 'io-import', 'Upload a spreadsheet', "Or upload a spreadsheet to add or update hundreds at once. I'll show a preview first, so nothing changes by surprise."),
      s('prod-undo', 'undo-toast', 'Undo', 'Every change shows a message with Undo for a few seconds. Tap it to put things back.', {note: 'It appears right after you save something.'})
    ]
  },
  {
    id: 'product-editor', title: 'The product form', section: 'products', route: 'products', sub: 'products', roles: STAFF,
    blurb: 'Every part of a product, from price to photos and data sheets.',
    keywords: ['product form', 'edit product', 'brand', 'category', 'subcategory', 'price', 'sale', 'discount', 'photo', 'gallery', 'colour', 'color', 'fitment', 'fits', 'bike', 'data sheet', 'pdf', 'sku', 'tags', 'hide product', 'save and add another'],
    steps: [
      s('ped-jump', 'editor-jump', 'Jump around', "Jump between the parts of the form. Don't worry, this is a practice form: nothing here gets saved.", {prepare: ed('product')}),
      s('ped-brand', 'field-brand', 'Brand', 'Pick a brand from the list, or type a new one and tap + New brand. Its logo comes along.', {prepare: ed('product')}),
      s('ped-category', 'field-category', 'Category', 'Choose a category. Need a new one? Pick + New category right here, no need to leave the form.', {prepare: ed('product')}),
      s('ped-sub', 'field-subcategory', 'Subcategory', 'Same for subcategories. The list only shows the ones inside the category you picked.', {prepare: ed('product')}),
      s('ped-price', 'ed-price', 'Price and sale price', 'Price and sale price in taka. The sale price must be lower than the price. Leave it empty for no discount.', {prepare: ed('product')}),
      s('ped-stock', 'ed-price', 'Stock and low-stock warning', "Stock and units. Set a low-stock level and I'll warn you on the home page before it runs out.", {prepare: ed('product')}),
      s('ped-gallery', 'gallery-add', 'Photos', 'Add up to 12 photos at once. Drag to reorder, tap one to make it the main photo or add alt text.', {prepare: ed('product')}),
      s('ped-colours', 'ed-colours', 'Colours', 'Colours with their own stock, so customers can pick the one they want.', {prepare: ed('product')}),
      s('ped-fitment', 'ed-fitment', 'Fits these bikes', 'Which bikes and cars this fits. Customers find it when they search their ride. Add a missing model without leaving.', {prepare: ed('product')}),
      s('ped-datasheet', 'ed-datasheet', 'Data sheet', 'Attach a PDF data sheet. Customers can open it from the product.', {prepare: ed('product')}),
      s('ped-advanced', 'ed-advanced', 'SKU and tags', 'SKU and tags help search and spreadsheets. Each SKU must be different.', {prepare: ed('product')}),
      s('ped-visibility', 'ed-visibility', 'Show or hide', 'Hide a product without deleting it. Handy for things that are coming soon.', {prepare: ed('product')}),
      s('ped-another', 'editor-save-another', 'Save and add another', 'Adding many? This saves and opens a fresh form with the same category ready.', {prepare: ed('product')}),
      s('ped-save', 'editor-save', 'Save', 'Save keeps it in your draft. Customers see it after you publish. In this practice form Save stays switched off.', {prepare: ed('product')})
    ]
  },
  {
    id: 'categories', title: 'Categories & subcategories', section: 'products', route: 'products', sub: 'categories', roles: STAFF,
    blurb: 'Add, order, rename and hide categories and their subcategories.',
    keywords: ['category', 'categories', 'subcategory', 'subcategories', 'add subcategory', 'add category', 'rename', 'order', 'menu link', 'reassign', 'move products'],
    steps: [
      s('cat-list', 'list', 'Your categories', 'Your categories with their subcategory and product counts. The order here is the order on your website.'),
      s('cat-drag', 'drag-handle', 'Change the order', 'Drag to set the order in the menu and the shop. The arrows do the same thing.'),
      s('cat-add', 'add-button', 'Add a category', 'Add a category. Give it a name and a picture and you are done.'),
      s('cat-actions', 'row-actions', 'Row actions', 'Add a product straight into this category, view its products, duplicate it or delete it.'),
      s('cat-subs', 'sub-list', 'Subcategories', 'Subcategories live inside the category. Rename them in place, add a photo, hide them or drag them into order.', {prepare: ed('category')}),
      s('cat-sub-add', 'sub-add', 'Add subcategories', 'Add as many subcategories as you need. Type a name and tap + Add. Renaming later never breaks your products.', {prepare: ed('category')}),
      s('cat-delete', 'editor-delete', 'Delete safely', 'Deleting a category with products asks where to move them first. Nothing is lost by surprise.', {prepare: ed('category'), note: 'The Delete button shows on categories you have already saved.'}),
      s('cat-boxes', 'website-boxes', 'Also add to website', "Tick these and I'll add the menu link, homepage card and shop section for you when you save.", {prepare: ed('category')}),
      s('cat-save', 'editor-save', 'Save', 'Save puts the category in your draft. Note: subcategories now show in the same order as here, not A to Z.', {prepare: ed('category')})
    ]
  },
  {
    id: 'brands', title: 'Brands & groups', section: 'products', route: 'products', sub: 'brands', roles: STAFF,
    blurb: 'Brand logos and the groups they belong to.',
    keywords: ['brand', 'brands', 'logo', 'brand group', 'engine oil', 'tyres', 'dealer'],
    steps: [
      s('brand-tab', 'tab-brands', 'Brands', 'Brand logos shown on the site. Products link to a brand by its name.'),
      s('brand-add', 'add-button', 'Add a brand', 'Add a brand with its name, logo and group.'),
      s('brand-groups', 'brand-groups', 'Brand groups', 'Groups like Engine oil or Tyres. Add your own, put them in order and choose where their Shop button goes.'),
      s('brand-actions', 'row-actions', 'Row actions', "Edit, duplicate or delete a brand. If products use it, I'll ask what to do with them first.")
    ]
  },
  {
    id: 'kits', title: 'Bundles', section: 'products', route: 'products', sub: 'kits', roles: STAFF,
    blurb: 'Sell several products together.',
    keywords: ['bundle', 'bundles', 'kit', 'kits', 'combo', 'package'],
    steps: [
      s('kit-tab', 'tab-kits', 'Bundles', 'Bundles sell several products together, like a full service kit.'),
      s('kit-add', 'add-button', 'Add a bundle', 'Combine products into a bundle with one price. Search and pick the products, then drag them into order.'),
      s('kit-row', 'row-first', 'Edit a bundle', 'Tap a bundle to change its products, price or photo.')
    ]
  },
  {
    id: 'vehicles', title: 'Bikes & cars', section: 'products', route: 'products', sub: 'vehicles', roles: STAFF,
    blurb: 'The models customers pick to find parts that fit.',
    keywords: ['bike', 'bikes', 'car', 'cars', 'vehicle', 'model', 'fitment', 'compatible'],
    steps: [
      s('veh-tab', 'tab-vehicles', 'Bikes & cars', 'The bike and car models customers choose in the part finder.'),
      s('veh-add', 'add-button', 'Add a model', 'Add a model with its maker and name. It shows up in every product form straight away.'),
      s('veh-actions', 'row-actions', 'Row actions', 'See and link the products that fit this model, or duplicate and delete it.')
    ]
  },
  {
    id: 'services', title: 'Services', section: 'services', route: 'services', sub: 'services', roles: STAFF,
    blurb: 'Workshop services, booking slots and homepage service cards.',
    keywords: ['service', 'services', 'workshop', 'booking', 'time slot', 'slots', 'service card', 'repair'],
    steps: [
      s('svc-tab', 'tab-services', 'Your services', 'Everything your workshop offers, with prices and how long each job takes.'),
      s('svc-cats', 'tab-categories', 'Groups and time slots', 'Service groups and booking time slots. Customers can only book the slots you set here.'),
      s('svc-blocks', 'tab-blocks', 'Homepage cards', 'The service cards on your homepage. Pick which services they point to.'),
      s('svc-add', 'add-button', 'Add a service', 'Add a new service with a price, a time and a short description.', {roles: STAFF})
    ]
  },
  {
    id: 'layout', title: 'Website layout', section: 'website', route: 'website', sub: 'layout', roles: STAFF,
    blurb: 'Add, move and hide the sections of your homepage and shop.',
    keywords: ['layout', 'section', 'sections', 'structure', 'carousel', 'grid', 'deals', 'new arrivals', 'homepage order', 'move section', 'hide section', 'add section', 'faq', 'promo'],
    steps: [
      s('lay-tab', 'tab-layout', 'Your website structure', "This is your website's structure. Every row is one section on the page, top to bottom."),
      s('lay-pages', 'layout-pages', 'Homepage or Shop', 'Switch between the Homepage and the Shop page.'),
      s('lay-drag', 'drag-handle', 'Move a section', 'Drag a section up or down to move it on the site. The arrows work too.'),
      s('lay-actions', 'row-actions', 'Section actions', 'Hide, edit, duplicate or delete a section. Built-in ones can be hidden and moved, but not deleted.'),
      s('lay-add', 'layout-add', 'Add a section', 'Add a new section anywhere on the page.'),
      s('lay-kinds', 'section-kinds', 'Pick a kind', 'Carousels, grids, deals, new arrivals, category tiles, banners, FAQs and more. Pick one and I fill in sensible settings.', {prepare: 'click:layout-add'}),
      s('lay-source', 'section-source', 'What it shows', 'Choose what it shows: a category, a subcategory, a brand, products on sale, the newest, or products you pick by hand.', {prepare: ed('section')}),
      s('lay-count', 'section-count', 'How many', "I'll tell you how many products will appear, so you never publish an empty section.", {prepare: ed('section')}),
      s('lay-preview', 'layout-preview', 'Preview draft', 'Check it on the preview before publishing. Customers see nothing until you publish.')
    ]
  },
  {
    id: 'website-tabs', title: 'Banners, text & menu', section: 'website', route: 'website', sub: 'banners', roles: STAFF,
    blurb: 'Banners, category cards, page text, the menu and Google.',
    keywords: ['banner', 'banners', 'slideshow', 'category card', 'text', 'words', 'content', 'menu', 'link', 'seo', 'google', 'sharing', 'history', 'restore', 'version', 'logos'],
    steps: [
      s('web-banners', 'tab-banners', 'Banners', 'Big pictures on the homepage. Set the photo, the words and where each one leads.'),
      s('web-cards', 'tab-categoryCards', 'Category cards', 'The category cards on your homepage. Each one opens a shop category.'),
      s('web-content', 'tab-content', 'Page content', 'Edit the words and pictures on every page, section by section.'),
      s('web-menu', 'tab-menu', 'Website menu', 'Menu links. Pick + New page to make a page on the spot.'),
      s('web-seo', 'tab-pages', 'Search & sharing', 'How you look on Google and when someone shares your link.'),
      s('web-history', 'history-list', 'Version history', 'Every publish is kept. Restore an older version if something goes wrong.', {route: 'website', sub: 'history', roles: OWNER})
    ]
  },
  {
    id: 'pages-posts', title: 'Pages & posts', section: 'website', route: 'publishing', roles: STAFF,
    blurb: 'Extra pages and blog posts, and linking them.',
    keywords: ['page', 'pages', 'post', 'posts', 'blog', 'news', 'article', 'story'],
    steps: [
      s('pp-page', 'add-button', 'Add a page', 'Make a new page, like a warranty or about page.'),
      s('pp-post', 'add-button', 'Add a post', 'Write a post with a title, a cover picture and your words. The layout is done for you.', {nth: 1}),
      s('pp-menu', 'tab-menu', 'Link them', 'Link them from the menu so customers can find them.', {route: 'website', sub: 'menu'})
    ]
  },
  {
    id: 'photos', title: 'Photos & files', section: 'photos', route: 'photos', roles: STAFF,
    blurb: 'Upload many photos, find unused ones, rename and replace.',
    keywords: ['photo', 'photos', 'picture', 'image', 'upload', 'library', 'alt text', 'replace', 'unused', 'pdf', 'delete photo'],
    steps: [
      s('ph-upload', 'photos-upload', 'Upload', 'Upload many photos at once. JPG, PNG or WebP, up to 5 MB each.'),
      s('ph-filters', 'photos-filters', 'Find a photo', 'Find unused photos, PDFs or product pictures with these chips and the search box.'),
      s('ph-details', 'photo-details', 'Photo details', 'Rename, add alt text, replace it everywhere at once, or delete it when nothing uses it.', {prepare: 'click:[data-ph-open]'}),
      s('ph-chooser', 'chooser-search', 'Picking a photo', 'The same search appears whenever you pick a photo for a product or banner.', {prepare: 'chooseImage'}),
      s('ph-nav', 'nav-photos', 'Find it again', 'Your photo library always lives here in the menu.')
    ]
  },
  {
    id: 'requests', title: 'Orders & bookings', section: 'orders', route: 'requests', roles: ROLES,
    blurb: 'New orders and workshop bookings.',
    keywords: ['order', 'orders', 'booking', 'bookings', 'request', 'requests', 'invoice', 'status', 'customer'],
    steps: [
      s('req-list', 'request-list', 'Your inbox', 'New orders and bookings land here. Contact the customer before you confirm.'),
      s('req-open', 'row-first', 'Open one', 'Open one for the details, your notes and the invoice.'),
      s('req-status', 'request-status', 'Update the status', 'Update the status so the whole team knows where it stands.', {prepare: 'click:[data-request]'})
    ]
  },
  {
    id: 'settings', title: 'Store settings', section: 'settings', route: 'settings', roles: ROLES,
    blurb: 'Your details, delivery, invoices, password and team.',
    keywords: ['settings', 'store details', 'phone', 'address', 'hours', 'delivery', 'delivery charge', 'invoice', 'payment', 'bkash', 'password', 'team', 'staff', 'tour progress'],
    steps: [
      s('set-business', 'settings-business', 'Business details', 'Your shop name, phone, WhatsApp, hours and address. They show all over your website.', {roles: STAFF}),
      s('set-delivery', 'settings-delivery', 'Delivery & orders', 'Delivery charges, delivery times and where order emails go.', {roles: STAFF}),
      s('set-invoice', 'settings-invoice', 'Invoices & payment', 'What your invoices say and how customers can pay.', {roles: STAFF}),
      s('set-password', 'settings-password', 'Your password', 'Change your own password here. You can also reset this tour from this panel.'),
      s('set-team', 'team-list', 'Your team', 'Add staff and choose what they can do: edit the website, publish, or handle requests.', {roles: OWNER, prepare: 'click:[data-action="staff"]'})
    ]
  },
  {
    id: 'publish', title: 'Save, preview, publish', section: 'publish', route: 'home', roles: ROLES,
    blurb: 'How your changes go from draft to live, and how to undo.',
    keywords: ['save', 'draft', 'preview', 'publish', 'live', 'review', 'undo', 'restore', 'go live'],
    steps: [
      s('pub-save', 'editor-save', 'Save is a draft', 'Saving updates your draft only. Customers see nothing yet.', {roles: STAFF, prepare: ed('product')}),
      s('pub-preview', 'topbar-preview', 'Preview', 'Preview shows your website with every saved change, just for you.', {roles: STAFF}),
      s('pub-review', 'review-list', 'Review', 'Review shows every change since the last publish.', {roles: STAFF, prepare: 'click:topbar-publish'}),
      s('pub-button', 'publish-button', 'Publish', 'Publishing makes it live. Customers see it the moment you tap.', {roles: STAFF, publish: true, prepare: 'click:topbar-publish'}),
      s('pub-undo', 'undo-toast', 'Undo', 'Undo fixes your last change right away.', {roles: STAFF, note: 'It appears right after you save something.'}),
      s('pub-history', 'history-list', 'Restore', 'Restore goes back to any earlier version if something goes wrong.', {roles: OWNER, route: 'website', sub: 'history'})
    ]
  }
];

export const CHAPTERS = RAW.map(c => ({
  ...c,
  steps: c.steps.map(st => ({route: c.route, ...(c.sub && !st.route ? {sub: c.sub} : {}), ...st, chapter: c.id}))
}));
export const STEPS = CHAPTERS.flatMap(c => c.steps);

const ANCHOR_RE = /^\[data-tour="([a-zA-Z0-9_-]+)"\]$/;
export const anchorOf = step => (ANCHOR_RE.exec(step?.target || '') || [])[1] || '';
export function anchorsUsed() {
  const out = new Set();
  for (const st of STEPS) {
    out.add(anchorOf(st));
    for (const v of [st.prepare, st.action]) {
      const m = /^click:([a-z0-9-]+)$/.exec(v || '');
      if (m) out.add(m[1]);
    }
  }
  out.delete('');
  return out;
}

// opts: {role, canPublish, phone}
export function allowed(item, {role = 'owner', canPublish = false, phone = null} = {}) {
  if (!item) return false;
  if (item.roles && !item.roles.includes(role)) return false;
  if (item.publish && !(role === 'owner' || canPublish)) return false;
  if (item.phoneOnly && phone === false) return false;
  return true;
}
export const chapterById = id => CHAPTERS.find(c => c.id === id) || null;
export function stepsFor(id, opts = {}) {
  const c = chapterById(id);
  if (!c || !allowed(c, {...opts, phone: null})) return [];
  return c.steps.filter(st => allowed(st, opts));
}
export function chaptersFor(opts = {}) {
  return CHAPTERS.filter(c => allowed(c, {...opts, phone: null}))
    .map(c => ({...c, steps: stepsFor(c.id, opts)}))
    .filter(c => c.steps.length);
}
export const minutesFor = steps => Math.max(1, Math.round((steps?.length || 0) * 12 / 60));

export function chapterForRoute(route, sub, {editorType} = {}) {
  if (editorType) {
    const byType = {product: 'product-editor', category: 'categories', section: 'layout', brand: 'brands', brandGroup: 'brands', kit: 'kits', vehicle: 'vehicles', service: 'services', block: 'website-tabs', banner: 'website-tabs', menu: 'website-tabs', content: 'website-tabs', page: 'pages-posts', post: 'pages-posts'};
    if (byType[editorType]) return byType[editorType];
  }
  if (route === 'products') return {categories: 'categories', brands: 'brands', kits: 'kits', vehicles: 'vehicles'}[sub] || 'products';
  if (route === 'website') return sub === 'layout' ? 'layout' : 'website-tabs';
  return {home: 'home', services: 'services', photos: 'photos', requests: 'requests', settings: 'settings', publishing: 'pages-posts'}[route] || 'getting-around';
}

const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function searchChapters(query, opts = {}) {
  const q = norm(query);
  if (q.length < 2) return [];
  const words = q.split(' ').filter(w => w.length > 1 && !['a', 'an', 'the', 'to', 'how', 'do', 'i', 'my', 'new'].includes(w));
  const scored = chaptersFor(opts).map(c => {
    const hay = [c.title, c.blurb, ...c.keywords, ...c.steps.map(st => st.title)].map(norm);
    let score = 0;
    if (hay.some(h => h.includes(q))) score += 10;
    for (const w of words) if (hay.some(h => h.includes(w) || (w.length > 3 && h.includes(w.replace(/s$/, ''))))) score += 2;
    return {c, score};
  }).filter(x => x.score >= (words.length > 1 ? 4 : 2));
  return scored.sort((a, b) => b.score - a.score).slice(0, 4).map(x => x.c);
}
