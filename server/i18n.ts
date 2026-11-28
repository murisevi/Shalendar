import type { Language } from '../shared/types.js';

export function resolveRequestLanguage(req: {
  header: (k: string) => string | undefined;
  query: (k: string) => string | undefined;
}): Language {
  const q = (req.query('lang') || '').toLowerCase();
  if (q === 'en' || q === 'es') return q;

  const h = (req.header('x-language') || '').toLowerCase();
  if (h === 'en' || h === 'es') return h;

  const accept = (req.header('accept-language') || '').toLowerCase();
  if (accept) {
    const first = accept.split(',')[0]?.trim() ?? '';
    if (first.startsWith('en')) return 'en';
    if (first.startsWith('es')) return 'es';
  }
  return 'es';
}

const EXACT_EN_ERRORS: Record<string, string> = {
  'Slugs inválidos': 'Invalid slugs',
  'Datos inválidos': 'Invalid data',
  'No encontramos esa quedada': 'Plan not found',
  'Quedada no encontrada': 'Plan not found',
  'Nombre inválido': 'Invalid name',
  'Ese nombre ya está en uso': 'That name is already taken',
  'Introduce tu nombre y PIN (mínimo 4 caracteres)': 'Enter your name and PIN (at least 4 characters)',
  'No se pudo recuperar el perfil': 'Could not recover profile',
  'No tienes permiso para editar este perfil': 'You do not have permission to edit this profile',
  'Error al actualizar perfil': 'Failed to update profile',
  'Solo el organizador o el propio participante puede darse de baja':
    'Only the organizer or the participant themselves can leave',
  'Sesión de participante no válida': 'Invalid participant session',
  'Error al guardar': 'Failed to save',
  'Fecha inválida': 'Invalid date',
  'Solo el organizador puede eliminar fechas candidatas':
    'Only the organizer can remove candidate dates',
  'Voto inválido': 'Invalid vote',
  'No se pudo votar': 'Could not vote',
  'Comentario inválido': 'Invalid comment',
  'Error al comentar': 'Failed to post comment',
  'RSVP inválido': 'Invalid RSVP',
  'Error al guardar asistencia': 'Failed to save RSVP',
  'Encuesta inválida': 'Invalid poll',
  'Opción inválida': 'Invalid option',
  'Error al añadir opción': 'Failed to add option',
  'Error al votar': 'Failed to vote',
  'Solo el organizador puede eliminar encuestas': 'Only the organizer can delete polls',
  'Ítem inválido': 'Invalid item',
  'Error al actualizar': 'Failed to update',
  'Datos de coche inválidos': 'Invalid ride data',
  'Error al añadir coche': 'Failed to add ride',
  'Participante inválido': 'Invalid participant',
  'No se pudo reservar plaza': 'Could not reserve seat',
  'Solo el organizador puede modificar los ajustes de esta quedada':
    'Only the organizer can modify plan settings',
  'Ajustes inválidos': 'Invalid settings',
  'Solo el organizador puede eliminar esta quedada': 'Only the organizer can delete this plan',
  'Escribe un título de al menos 2 caracteres': 'Enter a title of at least 2 characters',
  'Escribe tu nombre': 'Enter your name',
  'Escribe un mensaje': 'Write a message',
  'Escribe una pregunta': 'Write a question',
  'Escribe una opción': 'Write an option',
  'Escribe un ítem': 'Write an item',
  'Indica desde dónde sales': 'Specify where you are leaving from',
  'No encontramos a nadie con ese nombre en esta quedada.':
    'No participant with that name was found in this plan.',
  'Este perfil no tiene PIN configurado. Pide al organizador o usa tu enlace de traspaso.':
    'This profile has no PIN set. Ask the organizer or use your transfer link.',
  'El PIN no coincide. Inténtalo de nuevo.': 'Incorrect PIN. Please try again.',
  'Participante no encontrado': 'Participant not found',
  'Participante no encontrado en esta quedada': 'Participant not found in this plan',
  'La votación está cerrada': 'Voting is closed',
  'Encuesta no encontrada': 'Poll not found',
  'Opción no encontrada': 'Option not found',
  'Elemento no encontrado': 'Item not found',
  'Conductor no encontrado': 'Driver not found',
  'Coche no encontrado': 'Ride not found',
  'Ya eres el conductor de este coche.': 'You are already the driver of this car.',
  'Este coche ya está completo.': 'This car is already full.',
  'Error interno del servidor': 'Internal server error',
  'Endpoint desactivado': 'Endpoint disabled',
  'No autorizado': 'Unauthorized',
  'Has creado demasiadas quedadas en poco tiempo. Espera unos minutos.':
    'You created too many plans in a short time. Please wait a few minutes.',
  'Solo el organizador puede extender la duración de esta quedada':
    'Only the organizer can extend the expiration of this plan',
  'Días inválidos': 'Invalid days',
  'Esta quedada ha caducado y fue eliminada automáticamente.':
    'This plan has expired and was automatically deleted.',
  'Esta quedada caducó y sus datos se eliminaron automáticamente.':
    'This plan has expired and its data was automatically deleted.',
  'Demasiados intentos de PIN. Espera unos minutos.':
    'Too many PIN attempts. Please wait a few minutes.',
  'Enlace no válido (usa http:// o https://)':
    'Invalid link (use http:// or https://)',
  'Solo el organizador puede descargar la copia de seguridad':
    'Only the organizer can download the backup',
  'Solo el organizador puede elegir la opción ganadora':
    'Only the organizer can select the winning option',
  'Solo el conductor o el organizador puede borrar este coche':
    'Only the driver or organizer can remove this ride',
  'El PIN debe tener al menos 4 caracteres':
    'PIN must be at least 4 characters',
  'El mes final es anterior al inicial':
    'End month is before start month',
  'La fecha final es anterior al inicio o falta la fecha inicial':
    'End date is before start date or start date is missing',
  'Opcion no encontrada en esta encuesta':
    'Option not found in this poll',
  'Ruta no encontrada':
    'Route not found',
};

export function localizeServerError(message: string, lang: Language): string {
  if (lang !== 'en') return message;

  if (EXACT_EN_ERRORS[message]) {
    return EXACT_EN_ERRORS[message];
  }

  const dupJoinMatch = message.match(
    /^Ya hay alguien apuntado como «(.+)»\. Usa otro nombre o recupera tu perfil con PIN\.$/
  );
  if (dupJoinMatch) {
    return `Someone already joined as "${dupJoinMatch[1]}". Use another name or recover your profile with your PIN.`;
  }

  const dupUpdateMatch = message.match(/^Ya existe un participante llamado «(.+)»\.$/);
  if (dupUpdateMatch) {
    return `A participant named "${dupUpdateMatch[1]}" already exists.`;
  }

  const maxVotesMatch = message.match(
    /^Has alcanzado el máximo de (\d+) votos?\. Quita uno para votar otro día\.$/
  );
  if (maxVotesMatch) {
    const n = Number(maxVotesMatch[1]);
    return `You reached the maximum of ${n} ${n === 1 ? 'vote' : 'votes'}. Remove one to vote for another day.`;
  }

  return message;
}
