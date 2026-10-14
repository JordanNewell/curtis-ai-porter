// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Contract test — LIVE plugin parsers. Identical suite to the vendored run,
// but importing straight from the Curtis plugin repo checked out next door,
// so drift between the snapshot and the shipping plugin is caught the moment
// it happens. This file is only added to the test build when the sibling
// repo exists (see esbuild.config.mjs: CURTIS_PLUGIN_REPO, ../curtis-ai-chat
// or ../curtis) — elsewhere `npm test` simply skips it. The `curtis-live`
// alias is set by esbuild to whichever checkout it found.

import { registerContractSuite } from './contract-assertions';
import { parseCurt } from 'curtis-live/src/import/curt';
import { parseConversationMarkdown } from 'curtis-live/src/chat/conversation-format';

registerContractSuite('live curtis-ai-chat', { parseCurt, parseConversationMarkdown });
