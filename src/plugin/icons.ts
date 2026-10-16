// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Curtis AI Porter — custom icon registry.
//
// The mark IS the Curtis striped C — the same geometry as the
// curtis-ai.tech favicon (green #3E6746, four white cuts, outer ring),
// verbatim. No per-app logo variants: every Curtis surface carries this
// one mark. Fill colors are hardcoded as in the master, so no theme
// repaint applies.

export const PORTER_ICON_ID = 'curtis-porter-mark';

export const PORTER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 540" width="540" height="540">
	<defs>
		<path id="c-mark" d="M400.8 139.2 A185 185 0 1 0 400.8 400.8 L344.2 344.2 A105 105 0 1 1 344.2 195.8 Z"/>
		<clipPath id="c-clip"><use href="#c-mark"/></clipPath>
	</defs>
	<circle cx="270" cy="270" r="258" fill="none" stroke="#3E6746" stroke-width="10"/>
	<use href="#c-mark" fill="#3E6746"/>
	<g fill="#FFFFFF" clip-path="url(#c-clip)">
		<rect x="60" y="144" width="420" height="8"/>
		<rect x="60" y="192" width="420" height="8"/>
		<rect x="60" y="340" width="420" height="8"/>
		<rect x="60" y="388" width="420" height="8"/>
	</g>
</svg>`;
