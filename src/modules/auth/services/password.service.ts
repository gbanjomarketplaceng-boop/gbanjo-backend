import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

/** Argon2id hashing (OWASP-recommended parameters). */
@Injectable()
export class PasswordService {
  private readonly options: argon2.HashOptions = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
  /** Used when the account doesn't exist so failed logins take the same time either way. */
  private dummyHash?: Promise<string>;

  hash(password: string) {
    return argon2.hash(password, this.options);
  }

  async verify(hash: string | null | undefined, password: string) {
    if (!hash) {
      this.dummyHash ??= argon2.hash("not-a-real-password", this.options);
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    return argon2.verify(hash, password).catch(() => false);
  }
}
