/**
 * Global test setup: enable write-gate bypass so existing tests
 * don't need confirmation tokens. The write-gate-enforcement.test.ts
 * explicitly disables bypass to test gate behavior.
 */
import { enableWriteGateBypass } from "../../src/utils/write-gate.js";

enableWriteGateBypass();
