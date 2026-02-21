import {
  applyCorsHeaders,
  getAllowedCorsOrigins,
  sendJson,
  toErrorMessage,
  type EnvSource,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from './_common.js';
import { createSkillsIntegration } from '../server/skillsIntegration.js';

const ENV_SOURCE: EnvSource = {};
const skillsIntegration = createSkillsIntegration(ENV_SOURCE);
const allowedCorsOrigins = getAllowedCorsOrigins(ENV_SOURCE);

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  applyCorsHeaders(req, res, allowedCorsOrigins);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method Not Allowed. Use GET.' });
    return;
  }

  try {
    const status = await skillsIntegration.getStatus();
    sendJson(res, 200, status);
  } catch (error) {
    sendJson(res, 500, { error: toErrorMessage(error) });
  }
}
