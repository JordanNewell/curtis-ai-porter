// Copyright (c) 2026 Jordan Newell (Curtis AI)
// SPDX-License-Identifier: BUSL-1.1

// Contract test — LIVE plugin parsers. Identical suite to the vendored run,
// but importing straight from the curtis-ai-chat repo checked out next door,
// so drift between the snapshot and the shipping plugin is caught the moment
// it happens. This file is only added to the test build when the sibling
// repo exists (see esbuild.config.mjs) — elsewhere `npm test` simply skips it.

import { registerContractSuite } from './contract-assertions';
import { parseCurt } from '../../curtis-ai-chat/src/import/curt';
import { parseConversationMarkdown } from '../../curtis-ai-chat/src/chat/conversation-format';

registerContractSuite('live curtis-ai-chat', { parseCurt, parseConversationMarkdown });
