import {
  applyCorsHeaders,
  checkRateLimit,
  getAllowedCorsOrigins,
  isAuthorizedRequest,
  isTruthy,
  readEnvValue,
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

interface PublicSkillStatus {
  id: string;
  name: string;
  loaded: boolean;
  bytes: number;
  updatedAt: string;
  source?: string;
  error?: string;
}

const sanitizeStatus = (
  status: Awaited<ReturnType<typeof skillsIntegration.getStatus>>
): { enabled: boolean; skills: PublicSkillStatus[] } => {
  const includeDetails = isTruthy(
    readEnvValue(ENV_SOURCE, 'SKILLS_STATUS_INCLUDE_DETAILS')
  );

  return {
    enabled: status.enabled,
    skills: status.skills.map((skill) => {
      const sanitized: PublicSkillStatus = {
        id: skill.id,
        name: skill.name,
        loaded: skill.loaded,
        bytes: skill.bytes,
        updatedAt: skill.updatedAt,
      };

      if (includeDetails) {
        if (skill.source) {
          sanitized.source = skill.source;
        }

        if (skill.error) {
          sanitized.error = skill.error;
        }
      }

      return sanitized;
    }),
  };
};

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

  if (!isAuthorizedRequest(req, ENV_SOURCE)) {
    sendJson(res, 401, { error: 'Unauthorized request.' });
    return;
  }

  const rateLimit = checkRateLimit(req, ENV_SOURCE, {
    keyPrefix: 'skills-status',
    maxRequestsEnvKey: 'SKILLS_STATUS_RATE_LIMIT_MAX_REQUESTS',
    windowMsEnvKey: 'SKILLS_STATUS_RATE_LIMIT_WINDOW_MS',
    defaultMaxRequests: 60,
    defaultWindowMs: 60_000,
  });
  res.setHeader('X-RateLimit-Limit', String(rateLimit.limit));
  res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));
  res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
  if (!rateLimit.allowed) {
    sendJson(res, 429, {
      error: 'Rate limit exceeded. Please retry later.',
    });
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method Not Allowed. Use GET.' });
    return;
  }

  try {
    const status = await skillsIntegration.getStatus();
    sendJson(res, 200, sanitizeStatus(status));
  } catch (error) {
    sendJson(res, 500, { error: toErrorMessage(error) });
  }
}
