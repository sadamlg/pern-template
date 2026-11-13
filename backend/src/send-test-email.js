import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'mailpit',
  port: Number(process.env.SMTP_PORT || 1025),
  secure: false,
});

const result = await transporter.sendMail({
  from: 'infra@example.test',
  to: 'developer@example.test',
  subject: 'Prueba local de Mailpit',
  text: 'El worker puede entregar correo al servidor SMTP local de Mailpit.',
});

console.log(`Correo de prueba enviado a Mailpit: ${result.messageId}`);
