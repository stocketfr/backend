import {
  DEV_FALLBACK_FROM,
  resolveDefaultTransport,
} from './default-mailer.utils';
import { createMailer, type Mailer } from './mailer';

export const defaultMailer: Mailer = createMailer({
  transport: resolveDefaultTransport(),
  from: process.env.EMAIL_FROM ?? DEV_FALLBACK_FROM,
});
