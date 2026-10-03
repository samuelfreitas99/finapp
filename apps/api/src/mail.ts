import nodemailer from 'nodemailer';

export interface MailConfig {
  /** Ex.: `smtps://usuario:senha-de-app@smtp.gmail.com:465`. */
  smtpUrl: string;
  /** Remetente, ex.: `FinApp <seu-email@gmail.com>`. */
  from: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type Mailer = (message: MailMessage) => Promise<void>;

/** Envio de e-mail por SMTP (qualquer provedor: Gmail com senha de app, Brevo...). */
export function createMailer(config: MailConfig): Mailer {
  const transport = nodemailer.createTransport(config.smtpUrl);
  return async ({ to, subject, text }) => {
    await transport.sendMail({ from: config.from, to, subject, text });
  };
}

/** Texto do e-mail de redefinição de senha. */
export function resetPasswordMail(name: string, url: string): Omit<MailMessage, 'to'> {
  return {
    subject: 'FinApp: redefinir sua senha',
    text: [
      `Olá, ${name.split(' ')[0]}.`,
      '',
      'Recebemos um pedido para redefinir a senha da sua conta no FinApp.',
      `Para escolher uma senha nova, abra este link (vale por 1 hora):`,
      '',
      url,
      '',
      'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
    ].join('\n'),
  };
}
