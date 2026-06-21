import {
  resolveDefaultFromAddress,
  resolveDefaultTransport,
} from './default-mailer.utils';
import { createMailer, type Mailer } from './mailer';

export const defaultMailer: Mailer = createMailer({
  transport: resolveDefaultTransport(),
  from: resolveDefaultFromAddress(),
});
