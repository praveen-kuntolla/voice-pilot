import {createHash,randomBytes} from "node:crypto";
export function createInvitationToken(){const raw=randomBytes(32).toString("base64url");return {raw,hash:createHash("sha256").update(raw).digest("hex")};}
