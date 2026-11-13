import './globals.css';

export const metadata = {
  title: 'Plantilla PERN | Desarrollo local',
  description: 'Entorno local de desarrollo de Plantilla PERN.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
