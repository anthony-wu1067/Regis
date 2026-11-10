/* Bundled for browsers: the same Google / Claude / Canvas clients the desktop app uses. */
import { Buffer } from 'buffer';
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
const { Google, buildAuthUrl, zonedToUtc, SCOPES } = require('../../desktop/lib/google.js');
const { Anthropic } = require('../../desktop/lib/anthropic.js');
const { Canvas, normHost } = require('../../desktop/lib/canvas.js');
const { Guild, agentList } = require('../../desktop/lib/agents.js');
const { teamKit } = require('../../desktop/lib/teamkit.js');
globalThis.RegisLib = { Google, Anthropic, Canvas, Guild, agentList, teamKit, normHost, buildAuthUrl, SCOPES, zonedToUtc };
