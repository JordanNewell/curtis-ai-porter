// Contract test — vendored reference snapshot (always runs, no sibling repo
// needed). The porter's output must be accepted by the plugin's parsers; the
// snapshots in test/curtis-reference/ are verbatim copies of those parsers.
// When the actual curtis-ai-chat repo is checked out next door, the same
// suite also runs against its live code via curtis-contract-live.test.ts.

import { registerContractSuite } from './contract-assertions';
import { parseCurt } from './curtis-reference/parse-curt';
import { parseConversationMarkdown } from './curtis-reference/parse-conversation-markdown';

registerContractSuite('vendored v2.0.0', { parseCurt, parseConversationMarkdown });
