export interface AuthEmailUser {
  readonly email: string;
  readonly name: string;
}

export interface AuthEmailData {
  readonly user: AuthEmailUser;
  readonly url: string;
  readonly token: string;
}
