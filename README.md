# Moto Market

The English control room and branded storefront share one Supabase backend. GitHub Pages hosts the website. Supabase hosts staff sign-in, content, pictures, revisions and customer requests. The existing /admin/ address opens /control-room/.

- Website: https://ahmedmasum2000000.github.io/moto/
- Staff workspace: https://ahmedmasum2000000.github.io/moto/control-room/
- Staff guide: CONTROL_ROOM_PLAN.md

## Editing and live updates

Choose a task, save the draft, preview it and publish. Products, prices, discounts, colours, model compatibility, categories, services, menus, banners, logos, contact details, text, HTML/CSS pages and template posts are editable. A publication sends a small revision signal to open storefronts. A 30-second check catches reconnects. A customer filling a form gets a refresh prompt to preserve their typing.

Products assigned to a selected model appear in that model's search results. Universal products explicitly specify bikes, cars or both. Unassigned products remain in the general catalogue. Colour options have names, swatches, individual pictures and availability. Selected colours remain separate cart lines and are checked by the server.

## Staff permissions

Administrators have full content, publishing, restore, request and staff-management access. Content Managers edit website content and may publish only when enabled by an Administrator. Service Coordinators manage customer requests.

Staff can change their own password. Only Administrators can create staff, change another person's role, reset their password or disable access. Credentials live in Supabase Auth. Website files contain no staff passwords or GitHub tokens. The former Studio credential vault is retired; its passwords cannot be transferred. Use connected staff access.

## Requests

Orders and bookings are saved with a receipt. Server checks recalculate prices and colour availability. Retrying an unchanged request produces the same receipt. Requests are not online payments, inventory reservations or guaranteed service slots; staff contact the customer before confirming.

## Development and deployment

Use Node 22 or newer. Run npm ci, npm test and npm run build. The generated browser client is committed so GitHub Pages needs no application server. A local preview can run at http://127.0.0.1:8781.

Apply the Supabase migrations in order and deploy the two Edge Functions with their schema module. moto-admin requires a staff JWT plus a current active role. moto-request uses custom publishable-key authentication and exposes only validated guest request submission. Service credentials exist only in the Edge Function environment.

main is the source branch. Publish its tree to gh-pages with .nojekyll; the Pages workflow runs from that permitted branch. Content publishing changes the database directly and requires no Git commit. Recheck branch heads before deploying source changes.

The integration check is scripts/verify-backend.mjs. Supply MOTO_USERNAME and MOTO_PASSWORD privately as environment variables. It makes reversible QA edits, exercises permissions, images and requests, and restores the original content. Never commit those credentials.

## Limits

Coded pages accept sandboxed HTML/CSS; scripts and forms are disabled. Social crawlers that do not execute JavaScript may see static fallback sharing metadata. Pictures accept JPG, PNG or WebP, up to 5 MB. Staff see the latest 200 requests and 30 revisions.

Enable project-level leaked-password protection when available on the organization's plan: https://supabase.com/docs/guides/auth/password-security. Change temporary preview credentials before staff handover.
