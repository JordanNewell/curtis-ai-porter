// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Curtis AI Porter — custom icon registry.
//
// The mark IS the Curtis mark (2026-10 rebrand): the ringed C with four
// stripe cutouts, canonical source curtis/assets/brand/mark.svg (ink
// #1E7A46). This is the same 24px adaptation the Curtis plugin ships —
// thickened ring/stripes for ribbon sizes, currentColor so the mark
// follows the theme, stripes as CUTOUTS (mask) so it reads on both
// themes. No per-app logo variants: every Curtis surface carries this
// one mark.

export const PORTER_ICON_ID = 'curtis-porter-mark';

export const PORTER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><defs><mask id="curtis-stripes"><rect width="24" height="24" fill="#ffffff"/><rect x="0" y="6.23" width="24" height="0.8" fill="#000000"/><rect x="0" y="8.36" width="24" height="0.8" fill="#000000"/><rect x="0" y="14.94" width="24" height="0.8" fill="#000000"/><rect x="0" y="17.07" width="24" height="0.8" fill="#000000"/></mask></defs><circle cx="12" cy="12" r="11.2" stroke="currentColor" stroke-width="1.1"/><path d="M17.81 6.19 A8.22 8.22 0 1 0 17.81 17.81 L15.3 15.3 A4.67 4.67 0 1 1 15.3 8.7 Z" fill="currentColor" mask="url(#curtis-stripes)"/></svg>`;
