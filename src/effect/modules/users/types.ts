import { Schema } from 'effect';

export const TenantUserRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  image: Schema.NullOr(Schema.String),
  banned: Schema.NullOr(Schema.Boolean),
  banReason: Schema.NullOr(Schema.String),
  banExpires: Schema.NullOr(Schema.Date),
  createdAt: Schema.Date,
});

export type TenantUserRow = Schema.Schema.Type<typeof TenantUserRowSchema>;

export interface BetterAuthUser {
  readonly id: string;
  readonly name?: string | null;
  readonly email?: string | null;
  readonly image?: string | null;
  readonly banned?: boolean | null;
  readonly banReason?: string | null;
  readonly banExpires?: string | Date | null;
  readonly createdAt: string | Date;
}

export interface BetterAuthCreateUserBody {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  // Admin-created users skip self-serve verification: clicking the emailed
  // set-password link proves mailbox ownership, and without this flag
  // `requireEmailVerification` would lock them out of sign-in.
  readonly data?: { readonly emailVerified: boolean };
}

export interface BetterAuthCreateUserResponse {
  readonly user: BetterAuthUser;
}
