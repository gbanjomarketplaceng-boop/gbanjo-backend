export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;
export const PASSWORD_MESSAGE = "Password must be 8–72 characters and include a letter and a number";

/** How long a reset token from /password/verify-code stays valid. */
export const RESET_TOKEN_TTL_SECONDS = 15 * 60;

/** Requests with a just-rotated refresh token inside this window get TOKEN_ROTATED instead of revoking the session (parallel requests). */
export const REFRESH_REUSE_GRACE_SECONDS = 20;
