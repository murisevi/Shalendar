import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Language, SubPollCategory } from '../../shared/types';
import { getInitialLanguage, saveLanguage } from './storage';

export interface Translations {
  meta: {
    homeTitle: string;
    homeDescription: string;
  };
  common: {
    changeTheme: string;
    languageSelectorLabel: string;
    cancel: string;
    save: string;
    saving: string;
    close: string;
    delete: string;
    copy: string;
    copied: string;
    optional: string;
    youTag: string;
    friendFallback: string;
    someoneFallback: string;
    votes: (n: number) => string;
    people: (n: number) => string;
    confirmedCount: (n: number) => string;
    friendsJoined: (n: number) => string;
    hours: (n: number) => string;
  };
  home: {
    viewLiveDemo: string;
    heroTitleLead: string;
    heroTitleHighlight: string;
    heroSubtitle: string;
    pill1Title: string;
    pill1Desc: string;
    pill2Title: string;
    pill2Desc: string;
    pill3Title: string;
    pill3Desc: string;
    demoTag: string;
    demoMeta: (count: number) => string;
    demoExplore: string;
    formTitle: string;
    formSubtitle: string;
    planIconLabel: string;
    planTitleLabel: string;
    planTitlePlaceholder: string;
    organizerNameLabel: string;
    organizerNamePlaceholder: string;
    locationLabel: string;
    locationPlaceholder: string;
    hideAdvanced: string;
    showAdvanced: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    calendarModeLabel: string;
    modeDays: string;
    modeSlots: string;
    durationLabel: string;
    durationOptions: {
      1: string;
      2: string;
      3: string;
      4: string;
      5: string;
      7: string;
    };
    votesPerPersonLabel: string;
    holidaysLabel: string;
    autoCloseLabel: string;
    pinLabel: string;
    pinPlaceholder: string;
    blindVotingLabel: string;
    retentionLabel: string;
    creatingBtn: string;
    createBtn: string;
    recentTitle: string;
    recentHint: string;
    expiresInShort: (days: number) => string;
    errMissingFields: string;
    errPinTooShort: string;
    errCreateFailed: string;
  };
  plan: {
    loading: string;
    expiredTitle: string;
    expiredDesc: string;
    createNewPlanBtn: string;
    notFoundTitle: string;
    notFoundDesc: string;
    loadErrorTitle: string;
    loadErrorDesc: string;
    retryBtn: string;
    backHome: string;
    homeTitleTooltip: string;
    expiryBannerBefore: string;
    expiryBannerLessThan24h: string;
    expiryBannerDays: (days: number) => string;
    expiryBannerAfter: string;
    extend30Btn: string;
    exportJsonBtn: string;
    liveOnline: (count: number) => string;
    live: string;
    syncing: string;
    organizerSettingsTitle: string;
    shareBtn: string;
    confirmedBadge: string;
    googleCalendar: string;
    icsBtn: string;
    pngCardBtn: string;
    changeDateBtn: string;
    participatingAs: (name: string) => string;
    myStatsYes: (yes: number, maybe: number) => string;
    liveChangesHint: string;
    myProfilePin: string;
    previewModeStrong: string;
    previewModeText: string;
    joinWithName: string;
    tabs: {
      calendar: string;
      voting: string;
      matrix: string;
      logistics: string;
    };
    groupNotesTitle: (count: number) => string;
    groupNotesEmpty: string;
    groupNotePlaceholder: string;
    publishNoteAria: string;
    toasts: {
      sessionRestored: (name: string) => string;
      welcomeNew: (name: string) => string;
      welcomeBack: (name: string) => string;
      profileUpdated: string;
      leftPlan: string;
      saveAvailabilityErr: string;
      undone: string;
      voteAdded: string;
      voteRemoved: string;
      voteErr: string;
      dayAddedToPoll: string;
      proposeDayErr: string;
      pollOptionRemoved: string;
      deleteErr: string;
      dateConfirmed: (rangeLabel: string) => string;
      dateReopened: string;
      confirmErr: string;
      votingReopened: string;
      votingClosed: string;
      votingUpdateErr: string;
      settingsSaved: string;
      saveErr: string;
      participantRemoved: string;
      deletePlanErr: string;
      extendedExpiration: (days: number) => string;
      extendErr: string;
      backupDownloaded: string;
      backupErr: string;
      commentErr: string;
      rsvpUpdated: string;
      rsvpErr: string;
      icsDownloaded: string;
      pngReady: string;
      pngErr: string;
      pollCreated: string;
      optionAdded: string;
      winnerSet: string;
      winnerCleared: string;
      pollDeleted: string;
      carPublished: string;
      seatReserved: string;
      seatReleased: string;
      seatReserveErr: string;
      carDeleted: string;
    };
  };
  calendar: {
    brushLabel: string;
    brushYes: string;
    brushMaybe: string;
    brushNo: string;
    brushClear: string;
    brushInspect: string;
    undoTitle: string;
    undoLabel: string;
    viewOnlyMine: string;
    viewGroupAndMine: string;
    slotToPaint: string;
    allDaySlots: string;
    tipInspect: string;
    tipDrag: string;
    markWeekends: string;
    clearMonth: string;
    prevMonthAria: string;
    nextMonthAria: string;
    today: string;
    weekdayColumnTitle: (wd: string) => string;
    cellAriaLabel: (params: {
      date: string;
      holidayName?: string;
      yesCount: number;
      maybeCount: number;
      voteCount: number;
    }) => string;
    holidayPrefix: (name: string) => string;
    hasNotesTitle: string;
    myStatusYes: string;
    myStatusMaybe: string;
    myStatusNo: string;
    slotAvailableTitle: (slotLabel: string, count: number) => string;
    missingRequiredTitle: string;
    legendLess: string;
    legendAll: string;
    legendHoliday: string;
    legendSlotsShort: string;
    legendVotes: string;
    filterActive: (count: number) => string;
    filterPrompt: string;
    showAllGroup: string;
  };
  inspector: {
    emptyTitle: string;
    emptyDesc: string;
    dayDetailEyebrow: string;
    holidayTag: (name: string) => string;
    votedBtn: string;
    voteDayBtn: string;
    missingRequired: (names: string) => string;
    yesBtn: string;
    maybeBtn: string;
    noBtn: string;
    youYes: string;
    youMaybe: string;
    youNo: string;
    personalNotePlaceholder: string;
    personalNoteNeedsStatus: string;
    saveNoteTitle: string;
    groupYes: string;
    groupMaybe: string;
    groupNo: string;
    groupPending: string;
    dayCommentsTitle: string;
    dayCommentPlaceholder: string;
    sendCommentAria: string;
  };
  voting: {
    title: string;
    statusOpen: string;
    statusClosed: string;
    deadlineExpired: string;
    closesInDays: (days: number, hours: number) => string;
    closesInHours: (hours: number, mins: number) => string;
    closesInMins: (mins: number) => string;
    subtitleRemaining: (remaining: number, max: number) => string;
    subtitleUnlimited: string;
    subtitleClosed: string;
    proposeDay: string;
    closeVotingTitle: string;
    reopenVotingTitle: string;
    blindBannerStrong: string;
    blindBannerText: (votersCount: number) => string;
    bestRangesTitle: (days: number) => string;
    multiDayTag: string;
    holidayBadge: string;
    rangeAvailSummary: (yes: number, total: number, extraMaybe: number) => string;
    lockBlockBtn: string;
    sortLabel: string;
    sortSmart: string;
    sortVotes: string;
    sortAvailability: string;
    addCandidateTitle: string;
    addCandidateNotePlaceholder: string;
    addOptionBtn: string;
    emptyTitle: string;
    emptyDesc: string;
    badgeChosen: string;
    badgeLeader: string;
    badgeAllFree: string;
    availRatio: (yes: number, total: number, maybe: number) => string;
    voted: string;
    vote: string;
    confirm: string;
    removeCandidateTitle: string;
    confirmDateBtn: string;
  };
  matrix: {
    emptyTitle: string;
    emptyDesc: string;
    title: string;
    subtitle: (count: number, hasMe: boolean) => string;
    legendYes: string;
    legendMaybe: string;
    legendNo: string;
    friendHeader: string;
    clickToToggleTitle: string;
    totalAndVotes: string;
  };
  rsvp: {
    title: string;
    extraGuests: (count: number) => string;
    going: string;
    maybe: string;
    notGoing: string;
    guestsLabel: string;
    notePlaceholder: string;
  };
  logistics: {
    categories: Record<SubPollCategory, { label: string; emoji: string }>;
    pollsTitle: string;
    pollsSubtitle: string;
    newPollBtn: string;
    pollQuestionPlaceholder: string;
    pollOptionsPlaceholder: string;
    createPollBtn: string;
    pollsEmpty: string;
    addOptionBtn: string;
    deletePollTitle: string;
    optTitlePlaceholder: string;
    optUrlPlaceholder: string;
    optCostPlaceholder: string;
    addBtn: string;
    chosenBadge: string;
    viewLink: string;
    removeWinnerTitle: string;
    markWinnerTitle: string;
    checklistTitle: string;
    checklistSubtitle: string;
    checklistProgress: (done: number, total: number) => string;
    taskPlaceholder: string;
    assignToMe: string;
    checklistEmpty: string;
    unassignTaskTitle: string;
    reassignTaskTitle: string;
    claimTaskBtn: string;
    carpoolTitle: string;
    carpoolSubtitle: string;
    offerCarBtn: string;
    carOriginPlaceholder: string;
    seatsLabel: string;
    carTimePlaceholder: string;
    carNotesPlaceholder: string;
    publishCarBtn: string;
    carpoolEmpty: string;
    carOf: (name: string) => string;
    seatsLeft: (count: number) => string;
    carFull: string;
    releaseSeatBtn: string;
    reserveSeatBtn: string;
    youAreDriver: string;
    deleteCarTitle: string;
  };
  identity: {
    invitedEyebrow: string;
    editTitle: string;
    editSubtitle: string;
    tabNew: string;
    tabRecover: string;
    recoverDesc: string;
    recoverNamePlaceholder: string;
    recoverPinPlaceholder: string;
    namePlaceholder: string;
    colorAria: (color: string) => string;
    pinLabel: string;
    pinAlreadySet: string;
    pinPlaceholder: string;
    saveChangesBtn: string;
    verifyingBtn: string;
    recoverSessionBtn: string;
    joiningBtn: string;
    joinBtn: string;
    justBrowseBtn: string;
    leaveConfirm: string;
    leaveBtn: string;
    errWriteName: string;
    errPinLength: string;
    errUpdateFailed: string;
    errRecoverInput: string;
    errRecoverFailed: string;
    errJoinName: string;
    errOptionalPin: string;
    errJoinFailed: string;
  };
  intro: {
    eyebrow: string;
    title: string;
    step1Title: string;
    step1Desc: string;
    step2Title: string;
    step2Desc: string;
    cta: string;
  };
  settings: {
    title: string;
    subtitle: string;
    fieldTitle: string;
    fieldLocation: string;
    fieldDescription: string;
    fieldGranularity: string;
    granularityDay: string;
    granularitySlots: string;
    fieldDuration: string;
    durationDay: (days: number) => string;
    fieldMaxVotes: string;
    fieldHolidays: string;
    fieldDeadline: string;
    clearDeadline: string;
    blindVotingLabel: string;
    retentionTitle: string;
    autoDeleteIn: (days: number) => string;
    noAutoExpiration: string;
    extendingBtn: string;
    extend30Btn: string;
    exportBackupBtn: string;
    participantsHeader: (count: number) => string;
    orgBadge: string;
    requiredBadge: string;
    markKeyBtn: string;
    removeParticipantConfirm: (name: string) => string;
    removeParticipantTitle: string;
    coOrgPrompt: string;
    coOrgBtn: string;
    deletePlanConfirm: string;
    deletePlanBtn: string;
    saveSettingsBtn: string;
  };
  share: {
    title: string;
    subtitle: string;
    tabWhatsapp: string;
    tabQr: string;
    tabDevice: string;
    directLinkLabel: string;
    whatsappPreviewLabel: string;
    copyMessageBtn: string;
    generatingCard: string;
    downloadCardBtn: string;
    cardSharedToast: string;
    cardDownloadedToast: string;
    cardErrorToast: string;
    missingFriendsLabel: (names: string) => string;
    nudgeWhatsappBtn: string;
    qrDesc: string;
    qrAlt: string;
    deviceDescBefore: string;
    deviceDescBold: string;
    deviceDescAfter: string;
    deviceQrAlt: string;
    deviceLinkCopied: string;
    copyDeviceLinkBtn: string;
    devicePrivateWarning: string;
    deviceNeedSession: string;
    msgConfirmedHeader: (title: string) => string;
    msgWhen: (dateLabel: string, time: string | null) => string;
    msgLocation: (location: string) => string;
    msgConfirmedCta: string;
    msgTopHeader: (title: string) => string;
    msgBestDaysTitle: (peopleLabel: string) => string;
    msgDayRow: (index: number, dateLabel: string, yesCount: number, voteInfo: string) => string;
    msgOpenCta: string;
    msgEmptyHeader: (title: string) => string;
    msgEmptyCta: string;
    nudgeConfirmed: (names: string, title: string, dateRange: string, url: string) => string;
    nudgeOpen: (names: string, title: string, url: string) => string;
  };
  mobile: {
    navDates: string;
    navVote: string;
    navLogistics: string;
    navGroup: string;
    menuAria: string;
    shareAria: string;
    menuTitle: string;
    menuProfile: string;
    menuJoin: string;
    menuSettings: string;
    menuLanguage: string;
    menuTheme: string;
    themeDark: string;
    themeLight: string;
    menuHome: string;
    planInfoTitle: string;
    planInfoHint: string;
    topPillLabel: string;
    topPillFree: (yes: number, total: number) => string;
    topPillView: string;
    confirmedPillCta: string;
    filter: string;
    onlyMe: string;
    paintCta: string;
    paintHint: string;
    paintDone: string;
    paintYes: string;
    paintMaybe: string;
    paintNo: string;
    voteModeRanking: string;
    voteModeMatrix: string;
    logPolls: string;
    logChecklist: string;
    logCarpool: string;
    participantsTitle: (count: number) => string;
    onlineTag: string;
    joinCardTitle: string;
    joinCardDesc: string;
    myCardHint: string;
    editProfileBtn: string;
    matrixScrollHint: string;
  };
  avatar: {
    onlineSuffix: string;
    requiredSuffix: string;
    onlineAria: string;
    requiredAria: string;
  };
}

const ES: Translations = {
  meta: {
    homeTitle: 'Shalendar — Organiza quedadas y vota fechas con tus amigos',
    homeDescription:
      'Comparte un calendario con tus amigos, apunta los días que puedes, vota fechas y coordina la logística en tiempo real.',
  },
  common: {
    changeTheme: 'Cambiar tema',
    languageSelectorLabel: 'Seleccionar idioma',
    cancel: 'Cancelar',
    save: 'Guardar',
    saving: 'Guardando...',
    close: 'Cerrar',
    delete: 'Eliminar',
    copy: 'Copiar',
    copied: '¡Copiado!',
    optional: 'opcional',
    youTag: '(tú)',
    friendFallback: 'Amigo',
    someoneFallback: 'Alguien',
    votes: (n) => `${n} ${n === 1 ? 'voto' : 'votos'}`,
    people: (n) => `${n} ${n === 1 ? 'persona' : 'personas'}`,
    confirmedCount: (n) => `${n} ${n === 1 ? 'confirmado' : 'confirmados'}`,
    friendsJoined: (n) => `${n} ${n === 1 ? 'amigo apuntado' : 'amigos apuntados'}`,
    hours: (n) => `${n} ${n === 1 ? 'hora' : 'horas'}`,
  },
  home: {
    viewLiveDemo: 'Ver ejemplo en vivo',
    heroTitleLead: 'Encontrar un día para quedar ',
    heroTitleHighlight: 'sin morir en el intento.',
    heroSubtitle:
      'Crea un calendario privado en segundos, pásale el enlace o QR a tus amigos, pintad los días o franjas que podéis, votad fecha y lugar, y organizad coches y tareas sin salir del mismo link.',
    pill1Title: 'Días, franjas y escapadas',
    pill1Desc: 'Pinta deslizando, añade notas por día o busca puentes de varios días.',
    pill2Title: 'Votación inteligente',
    pill2Desc: 'Voto oculto, fecha límite, imprescindibles y ranking equilibrado.',
    pill3Title: 'Logística resuelta',
    pill3Desc: 'RSVP con +1, encuestas de sitio, checklist y reparto de coches.',
    demoTag: 'Ejemplo interactivo listo para probar',
    demoMeta: (count) =>
      `${count} ${count === 1 ? 'amigo apuntado' : 'amigos apuntados'} · votación y logística activas`,
    demoExplore: 'Explorar',
    formTitle: 'Crea una nueva quedada',
    formSubtitle: 'Enlace privado listo para compartir en 10 segundos. Sin registros.',
    planIconLabel: 'Icono del plan',
    planTitleLabel: '¿Qué plan queréis hacer?',
    planTitlePlaceholder: 'Ej: Escapada a la sierra, Cena de viernes, Partida de Catan...',
    organizerNameLabel: 'Tu nombre',
    organizerNamePlaceholder: 'Ej: Alex',
    locationLabel: 'Lugar',
    locationPlaceholder: 'Ej: Centro, Casa de Ana...',
    hideAdvanced: '− Ocultar opciones avanzadas',
    showAdvanced: '+ Franjas horarias, escapada multi-día, voto oculto o fecha límite',
    descriptionLabel: 'Descripción o detalles para el grupo',
    descriptionPlaceholder:
      'Ej: Apuntad los días que tenéis libres este mes y votad vuestro favorito.',
    calendarModeLabel: 'Modo de calendario',
    modeDays: 'Días',
    modeSlots: 'M / T / N',
    durationLabel: 'Duración del plan',
    durationOptions: {
      1: '1 día (quedada puntual)',
      2: '2 días seguidos (finde)',
      3: '3 días seguidos (puente)',
      4: '4 días seguidos (escapada)',
      5: '5 días seguidos (viaje)',
      7: '7 días seguidos (semana)',
    },
    votesPerPersonLabel: 'Votos por persona',
    holidaysLabel: 'Festivos en calendario',
    autoCloseLabel: 'Cierre automático votación',
    pinLabel: 'Tu PIN multi-dispositivo',
    pinPlaceholder: 'Ej: 1234 (para entrar desde otro móvil)',
    blindVotingLabel: 'Voto oculto hasta cerrar votación (evita el efecto rebaño)',
    retentionLabel: 'Memoria del calendario (sin cuentas)',
    creatingBtn: 'Creando calendario...',
    createBtn: 'Crear calendario y compartir',
    recentTitle: 'Tus quedadas recientes',
    recentHint: 'Solo visibles en este navegador',
    expiresInShort: (days) => `Caduca en ${days}d`,
    errMissingFields: 'Ponle un nombre a la quedada y dinos cómo te llamas.',
    errPinTooShort: 'El PIN opcional debe tener al menos 4 caracteres.',
    errCreateFailed: 'No se pudo crear la quedada',
  },
  plan: {
    loading: 'Cargando calendario...',
    expiredTitle: 'Esta quedada caducó',
    expiredDesc:
      'Sus datos se eliminaron automáticamente según la política de privacidad configurada por el organizador. Puedes crear una nueva quedada en segundos.',
    createNewPlanBtn: 'Crear nueva quedada',
    notFoundTitle: 'Quedada no encontrada',
    notFoundDesc:
      'El enlace puede haber cambiado o no existir todavía. Puedes crear un nuevo calendario en segundos.',
    loadErrorTitle: 'No se pudo conectar',
    loadErrorDesc:
      'Hubo un problema temporal al cargar la quedada. Tus datos siguen seguros; inténtalo de nuevo en unos segundos.',
    retryBtn: 'Reintentar',
    backHome: 'Volver al inicio',
    homeTitleTooltip: 'Inicio',
    expiryBannerBefore: 'Esta quedada se auto-eliminará en ',
    expiryBannerLessThan24h: 'menos de 24 h',
    expiryBannerDays: (days) => `${days} ${days === 1 ? 'día' : 'días'}`,
    expiryBannerAfter: ' para no dejar rastro.',
    extend30Btn: 'Extender +30 días',
    exportJsonBtn: 'Exportar .json',
    liveOnline: (count) => `En vivo · ${count} conectados`,
    live: 'En vivo',
    syncing: 'Sincronizando',
    organizerSettingsTitle: 'Ajustes del organizador',
    shareBtn: 'Compartir',
    confirmedBadge: '¡Fecha definitiva confirmada!',
    googleCalendar: 'Google Calendar',
    icsBtn: '.ics',
    pngCardBtn: 'Tarjeta PNG',
    changeDateBtn: 'Cambiar fecha',
    participatingAs: (name) => `Participando como ${name}`,
    myStatsYes: (yes, maybe) => `${yes} sí${maybe > 0 ? ` · ${maybe} quizá` : ''}`,
    liveChangesHint: 'Tus cambios se guardan al instante y tus amigos los ven en directo.',
    myProfilePin: 'Mi perfil / PIN',
    previewModeStrong: 'Modo vista previa:',
    previewModeText:
      'estás viendo la disponibilidad del grupo. Entra con tu nombre para pintar tus días, votar y apuntarte.',
    joinWithName: 'Entrar con mi nombre',
    tabs: {
      calendar: 'Calendario',
      voting: 'Votación',
      matrix: 'Comparativa',
      logistics: 'Logística',
    },
    groupNotesTitle: (count) => `Notas del grupo (${count})`,
    groupNotesEmpty: 'Deja un comentario rápido sobre horarios, sitio o ideas para la quedada.',
    groupNotePlaceholder: 'Escribe una nota para todos...',
    publishNoteAria: 'Publicar nota',
    toasts: {
      sessionRestored: (name) => `Sesión restaurada como ${name}`,
      welcomeNew: (name) => `¡Hola ${name}! Ya puedes pintar tus días y votar.`,
      welcomeBack: (name) => `¡Bienvenido de vuelta, ${name}!`,
      profileUpdated: 'Perfil actualizado',
      leftPlan: 'Has salido de la quedada',
      saveAvailabilityErr: 'Error al guardar disponibilidad',
      undone: 'Cambio deshecho',
      voteAdded: '★ Voto registrado',
      voteRemoved: 'Voto retirado',
      voteErr: 'No se pudo votar',
      dayAddedToPoll: 'Día añadido a la votación',
      proposeDayErr: 'Error al proponer día',
      pollOptionRemoved: 'Opción retirada de la votación',
      deleteErr: 'No se pudo eliminar',
      dateConfirmed: (rangeLabel) => `🎉 ¡Fecha confirmada: ${rangeLabel}!`,
      dateReopened: 'Fecha reabierta',
      confirmErr: 'No se pudo confirmar',
      votingReopened: 'Votación reabierta',
      votingClosed: 'Votación cerrada',
      votingUpdateErr: 'Error al actualizar votación',
      settingsSaved: 'Ajustes guardados',
      saveErr: 'No se pudo guardar',
      participantRemoved: 'Participante eliminado',
      deletePlanErr: 'No se pudo eliminar la quedada',
      extendedExpiration: (days) => `Duración extendida +${days} días`,
      extendErr: 'No se pudo extender',
      backupDownloaded: 'Copia .json descargada',
      backupErr: 'No se pudo descargar la copia de seguridad',
      commentErr: 'Error al enviar nota',
      rsvpUpdated: 'Asistencia actualizada',
      rsvpErr: 'Error al guardar RSVP',
      icsDownloaded: 'Archivo .ics descargado',
      pngReady: 'Tarjeta de invitación PNG lista',
      pngErr: 'Error al generar tarjeta PNG',
      pollCreated: 'Encuesta creada',
      optionAdded: 'Opción añadida',
      winnerSet: 'Opción marcada como ganadora',
      winnerCleared: 'Ganadora desmarcada',
      pollDeleted: 'Encuesta eliminada',
      carPublished: 'Coche publicado',
      seatReserved: 'Plaza reservada en el coche',
      seatReleased: 'Plaza liberada',
      seatReserveErr: 'No se pudo reservar',
      carDeleted: 'Coche eliminado',
    },
  },
  calendar: {
    brushLabel: 'Pincel:',
    brushYes: 'Puedo',
    brushMaybe: 'Quizá',
    brushNo: 'No puedo',
    brushClear: 'Borrar',
    brushInspect: 'Solo ver',
    undoTitle: 'Deshacer último cambio',
    undoLabel: 'Deshacer',
    viewOnlyMine: 'Vista: Solo mis días',
    viewGroupAndMine: 'Vista: Grupo + míos',
    slotToPaint: 'Franja a pintar:',
    allDaySlots: 'Todo el día (M+T+N)',
    tipInspect: 'Haz clic en cualquier día para ver quién puede ir y sus notas.',
    tipDrag: 'Arrastra sobre los días (o pulsa L–D arriba) para pintar rápido.',
    markWeekends: 'Marcar findes (V-D)',
    clearMonth: 'Limpiar mes',
    prevMonthAria: 'Mes anterior',
    nextMonthAria: 'Mes siguiente',
    today: 'Hoy',
    weekdayColumnTitle: (wd) => `Marcar o quitar todos los ${wd} del mes`,
    cellAriaLabel: ({ date, holidayName, yesCount, maybeCount, voteCount }) =>
      `${date}${holidayName ? `, festivo ${holidayName}` : ''}, ${yesCount} pueden, ${maybeCount} quizá, ${voteCount} votos`,
    holidayPrefix: (name) => `Festivo: ${name}`,
    hasNotesTitle: 'Hay notas en este día',
    myStatusYes: 'Tú: Puedo',
    myStatusMaybe: 'Tú: Quizá',
    myStatusNo: 'Tú: No puedo',
    slotAvailableTitle: (slotLabel, count) => `${slotLabel}: ${count} pueden`,
    missingRequiredTitle: 'Falta algún participante imprescindible',
    legendLess: 'Menos gente',
    legendAll: 'Todos pueden',
    legendHoliday: 'Festivo',
    legendSlotsShort: 'M · T · N',
    legendVotes: 'Votos',
    filterActive: (count) => `Mostrando días en que coinciden los ${count} seleccionados`,
    filterPrompt: 'Filtrar por amigos (ver qué días coinciden)',
    showAllGroup: 'Ver a todo el grupo',
  },
  inspector: {
    emptyTitle: 'Selecciona un día del calendario',
    emptyDesc: 'Verás quién puede ir, sus notas y podrás votar ese día al instante.',
    dayDetailEyebrow: 'Detalle del día',
    holidayTag: (name) => `Festivo: ${name}`,
    votedBtn: 'Votado',
    voteDayBtn: 'Votar día',
    missingRequired: (names) => `Aún no confirma (imprescindible): ${names}`,
    yesBtn: 'Puedo',
    maybeBtn: 'Quizá',
    noBtn: 'No puedo',
    youYes: 'Tú: Sí',
    youMaybe: 'Tú: Quizá',
    youNo: 'Tú: No',
    personalNotePlaceholder: 'Tu aclaración (ej: solo a partir de las 20:00)...',
    personalNoteNeedsStatus: 'Marca tu disponibilidad para añadir una aclaración',
    saveNoteTitle: 'Guardar aclaración',
    groupYes: 'Pueden',
    groupMaybe: 'Quizá',
    groupNo: 'No pueden',
    groupPending: 'Sin responder',
    dayCommentsTitle: 'Comentarios de este día',
    dayCommentPlaceholder: 'Añadir comentario para este día...',
    sendCommentAria: 'Enviar comentario',
  },
  voting: {
    title: 'Mejores días y votación',
    statusOpen: 'Activa',
    statusClosed: 'Cerrada',
    deadlineExpired: 'Plazo finalizado',
    closesInDays: (days, hours) => `Cierra en ${days}d ${hours}h`,
    closesInHours: (hours, mins) => `Cierra en ${hours}h ${mins}m`,
    closesInMins: (mins) => `Cierra en ${mins}m`,
    subtitleRemaining: (remaining, max) =>
      `Vota tus favoritas · Te quedan ${remaining} de ${max} votos`,
    subtitleUnlimited: 'Vota todas las fechas que prefieras para desempatar',
    subtitleClosed: 'La votación está cerrada.',
    proposeDay: 'Proponer día',
    closeVotingTitle: 'Cerrar votación',
    reopenVotingTitle: 'Reabrir votación',
    blindBannerStrong: 'Voto oculto activo:',
    blindBannerText: (votersCount) =>
      `solo ves tus votos. Se revelarán al cerrar la votación (${votersCount} ya han votado).`,
    bestRangesTitle: (days) => `Mejores bloques de ${days} días seguidos`,
    multiDayTag: 'Escapada multi-día',
    holidayBadge: 'Puente/Festivo',
    rangeAvailSummary: (yes, total, extraMaybe) =>
      `${yes}/${total} pueden todos los días${extraMaybe > 0 ? ` (+${extraMaybe} quizá)` : ''}`,
    lockBlockBtn: 'Fijar bloque',
    sortLabel: 'Ordenar:',
    sortSmart: '✨ Recomendado',
    sortVotes: '★ Votos',
    sortAvailability: '👥 Disponibilidad',
    addCandidateTitle: 'Añadir una fecha candidata a la votación',
    addCandidateNotePlaceholder: 'Nota breve (ej: Plan comida)',
    addOptionBtn: 'Añadir opción',
    emptyTitle: 'Aún no hay días marcados',
    emptyDesc:
      'Pinta tus días disponibles en el calendario y aquí aparecerán automáticamente las mejores fechas listas para votar.',
    badgeChosen: 'Elegida',
    badgeLeader: 'Líder',
    badgeAllFree: 'Todos pueden',
    availRatio: (yes, total, maybe) =>
      `${yes}/${total} pueden${maybe > 0 ? ` · ${maybe} quizá` : ''}`,
    voted: 'Votado',
    vote: 'Votar',
    confirm: 'Confirmar',
    removeCandidateTitle: 'Quitar fecha candidata',
    confirmDateBtn: 'Fijar fecha',
  },
  matrix: {
    emptyTitle: 'Todavía no hay datos para comparar',
    emptyDesc:
      'Marca algunos días en el calendario y aquí verás una tabla visual con la disponibilidad de cada amigo.',
    title: 'Tabla comparativa del grupo',
    subtitle: (count, hasMe) =>
      `Top ${count} mejores fechas · ${hasMe ? 'Haz clic en tu fila para editar al instante.' : 'Vista rápida de coincidencias.'}`,
    legendYes: 'Puedo',
    legendMaybe: 'Quizá',
    legendNo: 'No',
    friendHeader: 'Amigo',
    clickToToggleTitle: 'Haz clic para cambiar tu disponibilidad',
    totalAndVotes: 'Total & Votos',
  },
  rsvp: {
    title: 'Confirmación final de asistencia (RSVP)',
    extraGuests: (count) => ` (incl. +${count})`,
    going: '¡Voy seguro!',
    maybe: 'Aún duda',
    notGoing: 'No puedo ir',
    guestsLabel: 'Acompañantes:',
    notePlaceholder: 'Nota (ej: llego 15 min tarde, sin gluten...)',
  },
  logistics: {
    categories: {
      place: { label: '¿Dónde?', emoji: '📍' },
      activity: { label: '¿Qué hacemos?', emoji: '🎯' },
      other: { label: 'Otra decisión', emoji: '💡' },
    },
    pollsTitle: 'Encuestas: ¿Dónde? y ¿Qué hacemos?',
    pollsSubtitle:
      'Decidid restaurante, casa rural, actividad o película dentro del mismo enlace.',
    newPollBtn: 'Nueva encuesta',
    pollQuestionPlaceholder: 'Ej: ¿Dónde reservamos para cenar?',
    pollOptionsPlaceholder:
      'Opciones iniciales (una por línea, opcional):\nPizzería Napoli\nLa Taberna del Parque\nRamen Centro',
    createPollBtn: 'Crear encuesta',
    pollsEmpty:
      'Aún no hay encuestas abiertas. Crea una para votar restaurante, destino o plan.',
    addOptionBtn: 'Añadir opción',
    deletePollTitle: 'Eliminar encuesta',
    optTitlePlaceholder: 'Nombre (ej: Casa Rural El Pino)',
    optUrlPlaceholder: 'Enlace Maps / web (opcional)',
    optCostPlaceholder: 'Coste (ej: ~25€)',
    addBtn: 'Añadir',
    chosenBadge: 'Elegida',
    viewLink: 'Ver enlace',
    removeWinnerTitle: 'Quitar ganadora',
    markWinnerTitle: 'Marcar como ganadora',
    checklistTitle: 'Checklist: ¿Quién lleva qué?',
    checklistSubtitle: 'Repartid compras, reservas o cosas que traer con un clic.',
    checklistProgress: (done, total) => `${done}/${total} listo`,
    taskPlaceholder: 'Añadir tarea o cosa que llevar (ej: Hielo, Reservar mesa...)',
    assignToMe: 'Lo llevo yo',
    checklistEmpty: 'Sin tareas pendientes todavía.',
    unassignTaskTitle: 'Soltar tarea',
    reassignTaskTitle: 'Reasignarme esta tarea',
    claimTaskBtn: 'Me encargo',
    carpoolTitle: 'Reparto de coches (Carpooling)',
    carpoolSubtitle: 'Ofrece plazas libres en tu coche o reserva sitio en el de un amigo.',
    offerCarBtn: 'Ofrecer coche',
    carOriginPlaceholder: '¿Desde dónde sales? (ej: Metro Moncloa)',
    seatsLabel: 'Plazas:',
    carTimePlaceholder: 'Hora salida (ej: 19:45)',
    carNotesPlaceholder: 'Notas (ej: maletero grande, paso por el centro)',
    publishCarBtn: 'Publicar coche',
    carpoolEmpty: 'Aún nadie ha ofrecido coche para esta quedada.',
    carOf: (name) => `Coche de ${name}`,
    seatsLeft: (count) => `${count} ${count === 1 ? 'libre' : 'libres'}`,
    carFull: 'Completo',
    releaseSeatBtn: 'Tienes plaza (soltar)',
    reserveSeatBtn: 'Reservar plaza',
    youAreDriver: 'Eres el conductor',
    deleteCarTitle: 'Eliminar coche',
  },
  identity: {
    invitedEyebrow: 'Te han invitado a esta quedada',
    editTitle: 'Tu perfil en esta quedada',
    editSubtitle:
      'Cambia tu nombre, icono o configura un PIN para entrar desde otro dispositivo.',
    tabNew: 'Soy nuevo aquí',
    tabRecover: 'Ya entré en otro móvil',
    recoverDesc:
      'Introduce el mismo nombre y el PIN que pusiste al apuntarte para recuperar tu sesión.',
    recoverNamePlaceholder: 'Tu nombre exacto (ej: Pablo)',
    recoverPinPlaceholder: 'Tu PIN de recuperación',
    namePlaceholder: 'Tu nombre (ej: Pablo)',
    colorAria: (color) => `Color ${color}`,
    pinLabel: 'PIN multi-dispositivo',
    pinAlreadySet: 'ya configurado',
    pinPlaceholder: '4+ dígitos para recuperar tu perfil desde otro móvil',
    saveChangesBtn: 'Guardar cambios',
    verifyingBtn: 'Verificando...',
    recoverSessionBtn: 'Recuperar mi sesión',
    joiningBtn: 'Entrando...',
    joinBtn: 'Entrar y participar',
    justBrowseBtn: 'Solo echar un vistazo primero',
    leaveConfirm: '¿Seguro que quieres salir y borrar tus respuestas de esta quedada?',
    leaveBtn: 'Salir de esta quedada',
    errWriteName: 'Escribe tu nombre.',
    errPinLength: 'El PIN debe tener al menos 4 caracteres.',
    errUpdateFailed: 'No se pudo actualizar el perfil',
    errRecoverInput: 'Introduce tu nombre y tu PIN (mínimo 4 caracteres).',
    errRecoverFailed: 'No se pudo recuperar el perfil',
    errJoinName: 'Introduce tu nombre para participar.',
    errOptionalPin: 'El PIN opcional debe tener al menos 4 caracteres.',
    errJoinFailed: 'No se pudo entrar',
  },
  intro: {
    eyebrow: 'Antes de empezar',
    title: 'Así funciona, en dos pasos',
    step1Title: 'Marca los días que puedes',
    step1Desc: 'Pinta en el calendario los días que te vienen bien.',
    step2Title: 'Vota un día',
    step2Desc: 'Después, en la votación, elige el día que prefieras de entre los que mejor le vienen al grupo.',
    cta: '¡Entendido!',
  },
  settings: {
    title: 'Ajustes de la quedada',
    subtitle: 'Control del organizador · cambios sincronizados en vivo.',
    fieldTitle: 'Título',
    fieldLocation: 'Lugar',
    fieldDescription: 'Descripción',
    fieldGranularity: 'Modo de disponibilidad',
    granularityDay: 'Días completos',
    granularitySlots: 'Franjas (Mañana / Tarde / Noche)',
    fieldDuration: 'Duración (búsqueda multi-día)',
    durationDay: (days) => (days === 1 ? '1 día' : `${days} días consecutivos`),
    fieldMaxVotes: 'Máximo votos por persona (0 = sin límite)',
    fieldHolidays: 'Festivos en el calendario',
    fieldDeadline: 'Fecha límite de votación (opcional)',
    clearDeadline: 'Quitar',
    blindVotingLabel: 'Voto oculto (esconde los votos de los demás hasta cerrar votación)',
    retentionTitle: 'Memoria y caducidad',
    autoDeleteIn: (days) => `Auto-borrado en ${days} ${days === 1 ? 'día' : 'días'}`,
    noAutoExpiration: 'Sin caducidad automática',
    extendingBtn: 'Extendiendo...',
    extend30Btn: 'Extender +30 días',
    exportBackupBtn: 'Exportar copia (.json)',
    participantsHeader: (count) => `Participantes (${count}) · Marca los imprescindibles ★`,
    orgBadge: 'Org',
    requiredBadge: 'Imprescindible',
    markKeyBtn: 'Marcar clave',
    removeParticipantConfirm: (name) => `¿Eliminar a ${name} y sus respuestas?`,
    removeParticipantTitle: 'Eliminar participante',
    coOrgPrompt: '¿Compartir permisos de organizador con alguien de confianza?',
    coOrgBtn: 'Enlace admin',
    deletePlanConfirm:
      '¿Eliminar definitivamente esta quedada para todos? Esta acción no se puede deshacer.',
    deletePlanBtn: 'Borrar quedada',
    saveSettingsBtn: 'Guardar ajustes',
  },
  share: {
    title: 'Compartir quedada',
    subtitle: 'Enlace, tarjeta visual PNG, código QR o traspaso de dispositivo.',
    tabWhatsapp: 'Enlace y Chat',
    tabQr: 'Código QR',
    tabDevice: 'Otro móvil',
    directLinkLabel: 'Enlace directo del calendario',
    whatsappPreviewLabel: 'Vista previa para WhatsApp / Telegram',
    copyMessageBtn: 'Copiar mensaje',
    generatingCard: 'Generando tarjeta...',
    downloadCardBtn: 'Descargar tarjeta invitación (PNG)',
    cardSharedToast: 'Tarjeta compartida',
    cardDownloadedToast: 'Tarjeta de invitación PNG descargada',
    cardErrorToast: 'No se pudo generar la tarjeta PNG',
    missingFriendsLabel: (names) => `Faltan por responder: ${names}`,
    nudgeWhatsappBtn: 'Dar un toque en WhatsApp',
    qrDesc:
      'Escanea este QR con cualquier móvil para abrir la quedada al instante sin escribir nada.',
    qrAlt: 'QR de invitación',
    deviceDescBefore: 'Escanea este QR personal o copia el enlace para seguir editando con ',
    deviceDescBold: 'tu mismo perfil',
    deviceDescAfter: ' (y permisos de organizador si los tienes) en otro móvil u ordenador.',
    deviceQrAlt: 'QR de traspaso de sesión',
    deviceLinkCopied: '¡Enlace personal copiado!',
    copyDeviceLinkBtn: 'Copiar mi enlace personal',
    devicePrivateWarning:
      '⚠️ Enlace privado: no lo compartas en el grupo, es solo para tus dispositivos.',
    deviceNeedSession:
      'Primero entra con tu nombre para generar tu enlace de traspaso entre dispositivos.',
    msgConfirmedHeader: (title) => `*¡Fecha confirmada! ${title}*`,
    msgWhen: (dateLabel, time) => `Cuándo: *${dateLabel}*${time ? ` a las ${time}` : ''}`,
    msgLocation: (location) => `Lugar: ${location}`,
    msgConfirmedCta:
      'Confirma tu asistencia (RSVP), mira los coches y añádelo a tu calendario:',
    msgTopHeader: (title) => `*¡Vamos a organizar "${title}"!*`,
    msgBestDaysTitle: (peopleLabel) => `*Mejores días hasta ahora* (${peopleLabel}):`,
    msgDayRow: (index, dateLabel, yesCount, voteInfo) =>
      `${index}. ${dateLabel} — ${yesCount} pueden${voteInfo}`,
    msgOpenCta: 'Entra en el calendario, apunta qué días puedes y vota tu favorito:',
    msgEmptyHeader: (title) => `*¡Hola! Vamos a organizar "${title}"*`,
    msgEmptyCta: 'Entra en el calendario, marca los días que puedes y vota tu favorito:',
    nudgeConfirmed: (names, title, dateRange, url) =>
      `¡Hey ${names}! Ya tenemos fecha para *${title}* (${dateRange}). Confirma si vienes aquí:\n${url}`,
    nudgeOpen: (names, title, url) =>
      `¡Hey ${names}! Solo faltáis vosotros por marcar días o votar en *${title}*:\n${url}`,
  },
  mobile: {
    navDates: 'Fechas',
    navVote: 'Votar',
    navLogistics: 'Logística',
    navGroup: 'Grupo',
    menuAria: 'Más opciones',
    shareAria: 'Compartir plan',
    menuTitle: 'Opciones del plan',
    menuProfile: 'Mi perfil y PIN',
    menuJoin: 'Unirme con mi nombre',
    menuSettings: 'Ajustes de organizador',
    menuLanguage: 'Idioma',
    menuTheme: 'Apariencia',
    themeDark: 'Oscuro',
    themeLight: 'Claro',
    menuHome: 'Ir al inicio',
    planInfoTitle: 'Detalles del plan',
    planInfoHint: 'Toca para ver detalles',
    topPillLabel: 'TOP',
    topPillFree: (yes, total) => `${yes}/${total} libres`,
    topPillView: 'Ver',
    confirmedPillCta: 'Detalles',
    filter: 'Filtrar',
    onlyMe: 'Solo yo',
    paintCta: 'Marcar mis días',
    paintHint: 'Toca o arrastra sobre los días · toca otra vez para quitar',
    paintDone: 'Listo',
    paintYes: 'Sí',
    paintMaybe: 'Quizás',
    paintNo: 'No',
    voteModeRanking: 'Ranking',
    voteModeMatrix: 'Comparativa',
    logPolls: 'Sitio',
    logChecklist: 'Lista',
    logCarpool: 'Coches',
    participantsTitle: (count) => `Participantes (${count})`,
    onlineTag: 'en línea',
    joinCardTitle: 'Únete al plan',
    joinCardDesc: 'Pon tu nombre para marcar días, votar y comentar. Sin registros.',
    myCardHint: 'Tus cambios se guardan y sincronizan al instante.',
    editProfileBtn: 'Editar',
    matrixScrollHint: 'Desliza para ver más fechas →',
  },
  avatar: {
    onlineSuffix: ' · En línea',
    requiredSuffix: ' · Imprescindible',
    onlineAria: 'En línea',
    requiredAria: 'Imprescindible',
  },
};

const EN: Translations = {
  meta: {
    homeTitle: 'Shalendar — Plan hangouts and vote on dates with friends',
    homeDescription:
      'Share a calendar with your friends, mark the days you are free, vote on dates, and coordinate logistics in real time.',
  },
  common: {
    changeTheme: 'Toggle theme',
    languageSelectorLabel: 'Select language',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving...',
    close: 'Close',
    delete: 'Delete',
    copy: 'Copy',
    copied: 'Copied!',
    optional: 'optional',
    youTag: '(you)',
    friendFallback: 'Friend',
    someoneFallback: 'Someone',
    votes: (n) => `${n} ${n === 1 ? 'vote' : 'votes'}`,
    people: (n) => `${n} ${n === 1 ? 'person' : 'people'}`,
    confirmedCount: (n) => `${n} confirmed`,
    friendsJoined: (n) => `${n} ${n === 1 ? 'friend joined' : 'friends joined'}`,
    hours: (n) => `${n} ${n === 1 ? 'hour' : 'hours'}`,
  },
  home: {
    viewLiveDemo: 'View live demo',
    heroTitleLead: 'Agreeing on when to meet ',
    heroTitleHighlight: 'is finally easy.',
    heroSubtitle:
      'Create a private calendar in seconds, share the link or QR with your friends, paint the days or time slots you can make, vote on date and place, and organize rides and tasks in one place.',
    pill1Title: 'Days, slots & getaways',
    pill1Desc: 'Drag to paint, add per-day notes, or find multi-day consecutive blocks.',
    pill2Title: 'Smart voting',
    pill2Desc: 'Blind voting, deadlines, required attendees, and balanced ranking.',
    pill3Title: 'Logistics handled',
    pill3Desc: 'RSVP with +1s, place polls, checklist, and carpooling.',
    demoTag: 'Interactive demo ready to try',
    demoMeta: (count) =>
      `${count} ${count === 1 ? 'friend joined' : 'friends joined'} · live voting & logistics`,
    demoExplore: 'Explore',
    formTitle: 'Create a new plan',
    formSubtitle: 'Private link ready to share in 10 seconds. No sign-up required.',
    planIconLabel: 'Plan icon',
    planTitleLabel: 'What are you planning?',
    planTitlePlaceholder: 'e.g. Weekend cabin trip, Friday dinner, Board game night...',
    organizerNameLabel: 'Your name',
    organizerNamePlaceholder: 'e.g. Alex',
    locationLabel: 'Location',
    locationPlaceholder: "e.g. Downtown, Ana's place...",
    hideAdvanced: '− Hide advanced options',
    showAdvanced: '+ Time slots, multi-day trip, blind voting or deadline',
    descriptionLabel: 'Description or details for the group',
    descriptionPlaceholder:
      'e.g. Mark the days you are free this month and vote for your favorite.',
    calendarModeLabel: 'Calendar mode',
    modeDays: 'Days',
    modeSlots: 'M / A / E',
    durationLabel: 'Plan duration',
    durationOptions: {
      1: '1 day (single hangout)',
      2: '2 consecutive days (weekend)',
      3: '3 consecutive days (long weekend)',
      4: '4 consecutive days (getaway)',
      5: '5 consecutive days (trip)',
      7: '7 consecutive days (full week)',
    },
    votesPerPersonLabel: 'Votes per person',
    holidaysLabel: 'Calendar holidays',
    autoCloseLabel: 'Auto-close voting',
    pinLabel: 'Your multi-device PIN',
    pinPlaceholder: 'e.g. 1234 (to sign in from another device)',
    blindVotingLabel: 'Blind voting until closed (prevents bandwagon effect)',
    retentionLabel: 'Calendar memory (no accounts)',
    creatingBtn: 'Creating calendar...',
    createBtn: 'Create calendar & share',
    recentTitle: 'Your recent plans',
    recentHint: 'Only visible in this browser',
    expiresInShort: (days) => `Expires in ${days}d`,
    errMissingFields: 'Give the plan a title and tell us your name.',
    errPinTooShort: 'The optional PIN must be at least 4 characters.',
    errCreateFailed: 'Could not create the plan',
  },
  plan: {
    loading: 'Loading calendar...',
    expiredTitle: 'This plan has expired',
    expiredDesc:
      'Its data was automatically removed according to the privacy policy set by the organizer. You can create a new plan in seconds.',
    createNewPlanBtn: 'Create a new plan',
    notFoundTitle: 'Plan not found',
    notFoundDesc:
      'The link may have changed or does not exist yet. You can create a new calendar in seconds.',
    loadErrorTitle: 'Could not connect',
    loadErrorDesc:
      'There was a temporary problem loading this plan. Your data is safe; please try again in a few seconds.',
    retryBtn: 'Try again',
    backHome: 'Back to home',
    homeTitleTooltip: 'Home',
    expiryBannerBefore: 'This plan will auto-delete in ',
    expiryBannerLessThan24h: 'less than 24h',
    expiryBannerDays: (days) => `${days} ${days === 1 ? 'day' : 'days'}`,
    expiryBannerAfter: ' leaving no trace.',
    extend30Btn: 'Extend +30 days',
    exportJsonBtn: 'Export .json',
    liveOnline: (count) => `Live · ${count} online`,
    live: 'Live',
    syncing: 'Syncing',
    organizerSettingsTitle: 'Organizer settings',
    shareBtn: 'Share',
    confirmedBadge: 'Final date confirmed!',
    googleCalendar: 'Google Calendar',
    icsBtn: '.ics',
    pngCardBtn: 'PNG Card',
    changeDateBtn: 'Change date',
    participatingAs: (name) => `Participating as ${name}`,
    myStatsYes: (yes, maybe) => `${yes} yes${maybe > 0 ? ` · ${maybe} maybe` : ''}`,
    liveChangesHint: 'Your changes are saved instantly and your friends see them live.',
    myProfilePin: 'My profile / PIN',
    previewModeStrong: 'Preview mode:',
    previewModeText:
      'you are viewing the group availability. Join with your name to paint your days, vote, and RSVP.',
    joinWithName: 'Join with my name',
    tabs: {
      calendar: 'Calendar',
      voting: 'Voting',
      matrix: 'Comparison',
      logistics: 'Logistics',
    },
    groupNotesTitle: (count) => `Group notes (${count})`,
    groupNotesEmpty: 'Leave a quick note about times, venue, or ideas for the plan.',
    groupNotePlaceholder: 'Write a note for everyone...',
    publishNoteAria: 'Post note',
    toasts: {
      sessionRestored: (name) => `Session restored as ${name}`,
      welcomeNew: (name) => `Hi ${name}! You can now paint your days and vote.`,
      welcomeBack: (name) => `Welcome back, ${name}!`,
      profileUpdated: 'Profile updated',
      leftPlan: 'You left the plan',
      saveAvailabilityErr: 'Failed to save availability',
      undone: 'Change undone',
      voteAdded: '★ Vote recorded',
      voteRemoved: 'Vote removed',
      voteErr: 'Could not vote',
      dayAddedToPoll: 'Day added to voting',
      proposeDayErr: 'Failed to propose day',
      pollOptionRemoved: 'Option removed from voting',
      deleteErr: 'Could not delete',
      dateConfirmed: (rangeLabel) => `🎉 Date confirmed: ${rangeLabel}!`,
      dateReopened: 'Date reopened',
      confirmErr: 'Could not confirm date',
      votingReopened: 'Voting reopened',
      votingClosed: 'Voting closed',
      votingUpdateErr: 'Failed to update voting',
      settingsSaved: 'Settings saved',
      saveErr: 'Could not save',
      participantRemoved: 'Participant removed',
      deletePlanErr: 'Could not delete the plan',
      extendedExpiration: (days) => `Expiration extended by +${days} days`,
      extendErr: 'Could not extend expiration',
      backupDownloaded: '.json backup downloaded',
      backupErr: 'Could not download the backup',
      commentErr: 'Failed to post note',
      rsvpUpdated: 'RSVP updated',
      rsvpErr: 'Failed to save RSVP',
      icsDownloaded: '.ics file downloaded',
      pngReady: 'PNG invite card ready',
      pngErr: 'Failed to generate PNG card',
      pollCreated: 'Poll created',
      optionAdded: 'Option added',
      winnerSet: 'Option marked as winner',
      winnerCleared: 'Winner cleared',
      pollDeleted: 'Poll deleted',
      carPublished: 'Ride published',
      seatReserved: 'Seat reserved in the car',
      seatReleased: 'Seat released',
      seatReserveErr: 'Could not reserve seat',
      carDeleted: 'Ride deleted',
    },
  },
  calendar: {
    brushLabel: 'Brush:',
    brushYes: 'Available',
    brushMaybe: 'Maybe',
    brushNo: 'Busy',
    brushClear: 'Erase',
    brushInspect: 'View only',
    undoTitle: 'Undo last change',
    undoLabel: 'Undo',
    viewOnlyMine: 'View: Only my days',
    viewGroupAndMine: 'View: Group + mine',
    slotToPaint: 'Time slot:',
    allDaySlots: 'All day (M+A+E)',
    tipInspect: 'Click any day to see who can make it and read notes.',
    tipDrag: 'Drag across days (or click M–S above) to paint quickly.',
    markWeekends: 'Mark weekends (F–S)',
    clearMonth: 'Clear month',
    prevMonthAria: 'Previous month',
    nextMonthAria: 'Next month',
    today: 'Today',
    weekdayColumnTitle: (wd) => `Toggle all ${wd} days this month`,
    cellAriaLabel: ({ date, holidayName, yesCount, maybeCount, voteCount }) =>
      `${date}${holidayName ? `, holiday ${holidayName}` : ''}, ${yesCount} available, ${maybeCount} maybe, ${voteCount} votes`,
    holidayPrefix: (name) => `Holiday: ${name}`,
    hasNotesTitle: 'This day has notes',
    myStatusYes: 'You: Available',
    myStatusMaybe: 'You: Maybe',
    myStatusNo: 'You: Busy',
    slotAvailableTitle: (slotLabel, count) => `${slotLabel}: ${count} available`,
    missingRequiredTitle: 'A required attendee is missing',
    legendLess: 'Fewer people',
    legendAll: 'Everyone free',
    legendHoliday: 'Holiday',
    legendSlotsShort: 'M · A · E',
    legendVotes: 'Votes',
    filterActive: (count) => `Showing days where all ${count} selected match`,
    filterPrompt: 'Filter by friends (see matching days)',
    showAllGroup: 'Show whole group',
  },
  inspector: {
    emptyTitle: 'Select a day on the calendar',
    emptyDesc: 'See who can make it, read their notes, and vote for that day instantly.',
    dayDetailEyebrow: 'Day details',
    holidayTag: (name) => `Holiday: ${name}`,
    votedBtn: 'Voted',
    voteDayBtn: 'Vote day',
    missingRequired: (names) => `Not confirmed yet (required): ${names}`,
    yesBtn: 'Available',
    maybeBtn: 'Maybe',
    noBtn: 'Busy',
    youYes: 'You: Yes',
    youMaybe: 'You: Maybe',
    youNo: 'You: No',
    personalNotePlaceholder: 'Your note (e.g. only free after 8 PM)...',
    personalNoteNeedsStatus: 'Mark your availability to add a note',
    saveNoteTitle: 'Save note',
    groupYes: 'Available',
    groupMaybe: 'Maybe',
    groupNo: 'Unavailable',
    groupPending: 'No reply yet',
    dayCommentsTitle: 'Comments for this day',
    dayCommentPlaceholder: 'Add a comment for this day...',
    sendCommentAria: 'Send comment',
  },
  voting: {
    title: 'Best days & voting',
    statusOpen: 'Open',
    statusClosed: 'Closed',
    deadlineExpired: 'Deadline passed',
    closesInDays: (days, hours) => `Closes in ${days}d ${hours}h`,
    closesInHours: (hours, mins) => `Closes in ${hours}h ${mins}m`,
    closesInMins: (mins) => `Closes in ${mins}m`,
    subtitleRemaining: (remaining, max) =>
      `Vote for your favorites · ${remaining} of ${max} votes left`,
    subtitleUnlimited: 'Vote for as many dates as you like to break ties',
    subtitleClosed: 'Voting is closed.',
    proposeDay: 'Propose day',
    closeVotingTitle: 'Close voting',
    reopenVotingTitle: 'Reopen voting',
    blindBannerStrong: 'Blind voting active:',
    blindBannerText: (votersCount) =>
      `you only see your own votes. Results reveal once voting closes (${votersCount} already voted).`,
    bestRangesTitle: (days) => `Best ${days}-day consecutive blocks`,
    multiDayTag: 'Multi-day trip',
    holidayBadge: 'Holiday',
    rangeAvailSummary: (yes, total, extraMaybe) =>
      `${yes}/${total} free all days${extraMaybe > 0 ? ` (+${extraMaybe} maybe)` : ''}`,
    lockBlockBtn: 'Set dates',
    sortLabel: 'Sort:',
    sortSmart: '✨ Recommended',
    sortVotes: '★ Votes',
    sortAvailability: '👥 Availability',
    addCandidateTitle: 'Add a candidate date to the poll',
    addCandidateNotePlaceholder: 'Short note (e.g. Lunch plan)',
    addOptionBtn: 'Add option',
    emptyTitle: 'No days marked yet',
    emptyDesc:
      'Paint your available days on the calendar and the best dates will automatically appear here ready to vote.',
    badgeChosen: 'Chosen',
    badgeLeader: 'Leading',
    badgeAllFree: 'Everyone free',
    availRatio: (yes, total, maybe) =>
      `${yes}/${total} free${maybe > 0 ? ` · ${maybe} maybe` : ''}`,
    voted: 'Voted',
    vote: 'Vote',
    confirm: 'Confirm',
    removeCandidateTitle: 'Remove candidate date',
    confirmDateBtn: 'Confirm date',
  },
  matrix: {
    emptyTitle: 'No data to compare yet',
    emptyDesc:
      "Mark some days on the calendar and you'll see a visual matrix with each friend's availability here.",
    title: 'Group comparison matrix',
    subtitle: (count, hasMe) =>
      `Top ${count} best dates · ${hasMe ? 'Click your row to edit availability instantly.' : 'Quick overlap overview.'}`,
    legendYes: 'Available',
    legendMaybe: 'Maybe',
    legendNo: 'Busy',
    friendHeader: 'Friend',
    clickToToggleTitle: 'Click to change your availability',
    totalAndVotes: 'Total & Votes',
  },
  rsvp: {
    title: 'Final attendance confirmation (RSVP)',
    extraGuests: (count) => ` (incl. +${count})`,
    going: "I'm going!",
    maybe: 'Still unsure',
    notGoing: "Can't make it",
    guestsLabel: 'Extra guests:',
    notePlaceholder: 'Note (e.g. arriving 15 min late, gluten-free...)',
  },
  logistics: {
    categories: {
      place: { label: 'Where?', emoji: '📍' },
      activity: { label: 'What to do?', emoji: '🎯' },
      other: { label: 'Other decision', emoji: '💡' },
    },
    pollsTitle: 'Polls: Where & What to do?',
    pollsSubtitle:
      'Decide on the restaurant, cabin, activity, or movie right inside the same link.',
    newPollBtn: 'New poll',
    pollQuestionPlaceholder: 'e.g. Where should we book dinner?',
    pollOptionsPlaceholder:
      'Initial options (one per line, optional):\nNapoli Pizzeria\nPark Tavern\nDowntown Ramen',
    createPollBtn: 'Create poll',
    pollsEmpty: 'No open polls yet. Create one to vote on a restaurant, destination, or activity.',
    addOptionBtn: 'Add option',
    deletePollTitle: 'Delete poll',
    optTitlePlaceholder: 'Name (e.g. Pine Cabin)',
    optUrlPlaceholder: 'Maps / website link (optional)',
    optCostPlaceholder: 'Est. cost (e.g. ~$25)',
    addBtn: 'Add',
    chosenBadge: 'Chosen',
    viewLink: 'Open link',
    removeWinnerTitle: 'Remove winner',
    markWinnerTitle: 'Mark as winner',
    checklistTitle: "Checklist: Who's bringing what?",
    checklistSubtitle: 'Split groceries, bookings, or items to bring in one click.',
    checklistProgress: (done, total) => `${done}/${total} done`,
    taskPlaceholder: 'Add a task or item to bring (e.g. Ice, Book table...)',
    assignToMe: "I'll bring it",
    checklistEmpty: 'No tasks yet.',
    unassignTaskTitle: 'Unassign task',
    reassignTaskTitle: 'Assign this task to me',
    claimTaskBtn: "I'll take it",
    carpoolTitle: 'Carpooling',
    carpoolSubtitle: "Offer spare seats in your car or claim a spot in a friend's ride.",
    offerCarBtn: 'Offer a ride',
    carOriginPlaceholder: 'Leaving from? (e.g. Central Station)',
    seatsLabel: 'Seats:',
    carTimePlaceholder: 'Departure (e.g. 19:45)',
    carNotesPlaceholder: 'Notes (e.g. big trunk, passing through downtown)',
    publishCarBtn: 'Publish ride',
    carpoolEmpty: 'Nobody has offered a ride for this plan yet.',
    carOf: (name) => `${name}'s car`,
    seatsLeft: (count) => `${count} ${count === 1 ? 'seat left' : 'seats left'}`,
    carFull: 'Full',
    releaseSeatBtn: 'Seat reserved (release)',
    reserveSeatBtn: 'Reserve a seat',
    youAreDriver: "You're the driver",
    deleteCarTitle: 'Delete ride',
  },
  identity: {
    invitedEyebrow: "You've been invited to this plan",
    editTitle: 'Your profile in this plan',
    editSubtitle:
      'Change your name, icon, or set a PIN to sign in from another device.',
    tabNew: "I'm new here",
    tabRecover: 'Joined on another device',
    recoverDesc:
      'Enter the same name and PIN you used when joining to recover your session.',
    recoverNamePlaceholder: 'Your exact name (e.g. Alex)',
    recoverPinPlaceholder: 'Your recovery PIN',
    namePlaceholder: 'Your name (e.g. Alex)',
    colorAria: (color) => `Color ${color}`,
    pinLabel: 'Multi-device PIN',
    pinAlreadySet: 'already set',
    pinPlaceholder: '4+ digits to recover your profile on another device',
    saveChangesBtn: 'Save changes',
    verifyingBtn: 'Verifying...',
    recoverSessionBtn: 'Recover my session',
    joiningBtn: 'Joining...',
    joinBtn: 'Join & participate',
    justBrowseBtn: 'Just take a look first',
    leaveConfirm: 'Are you sure you want to leave and erase your responses from this plan?',
    leaveBtn: 'Leave this plan',
    errWriteName: 'Please enter your name.',
    errPinLength: 'The PIN must be at least 4 characters.',
    errUpdateFailed: 'Could not update profile',
    errRecoverInput: 'Enter your name and PIN (at least 4 characters).',
    errRecoverFailed: 'Could not recover profile',
    errJoinName: 'Enter your name to participate.',
    errOptionalPin: 'The optional PIN must be at least 4 characters.',
    errJoinFailed: 'Could not join',
  },
  intro: {
    eyebrow: 'Before you start',
    title: 'How it works, in two steps',
    step1Title: 'Mark the days you can make',
    step1Desc: 'Paint the days that work for you on the calendar.',
    step2Title: 'Vote for a day',
    step2Desc: 'Then, in the voting, pick your favourite among the days that suit the group best.',
    cta: 'Got it!',
  },
  settings: {
    title: 'Plan settings',
    subtitle: 'Organizer controls · changes sync live.',
    fieldTitle: 'Title',
    fieldLocation: 'Location',
    fieldDescription: 'Description',
    fieldGranularity: 'Availability mode',
    granularityDay: 'Full days',
    granularitySlots: 'Time slots (Morning / Afternoon / Evening)',
    fieldDuration: 'Duration (multi-day finder)',
    durationDay: (days) => (days === 1 ? '1 day' : `${days} consecutive days`),
    fieldMaxVotes: 'Max votes per person (0 = unlimited)',
    fieldHolidays: 'Calendar holidays',
    fieldDeadline: 'Voting deadline (optional)',
    clearDeadline: 'Clear',
    blindVotingLabel: 'Blind voting (hides other votes until voting closes)',
    retentionTitle: 'Memory & expiration',
    autoDeleteIn: (days) => `Auto-delete in ${days} ${days === 1 ? 'day' : 'days'}`,
    noAutoExpiration: 'No automatic expiration',
    extendingBtn: 'Extending...',
    extend30Btn: 'Extend +30 days',
    exportBackupBtn: 'Export backup (.json)',
    participantsHeader: (count) => `Participants (${count}) · Mark required ★`,
    orgBadge: 'Host',
    requiredBadge: 'Required',
    markKeyBtn: 'Mark key',
    removeParticipantConfirm: (name) => `Remove ${name} and their responses?`,
    removeParticipantTitle: 'Remove participant',
    coOrgPrompt: 'Share organizer permissions with someone you trust?',
    coOrgBtn: 'Admin link',
    deletePlanConfirm:
      'Permanently delete this plan for everyone? This action cannot be undone.',
    deletePlanBtn: 'Delete plan',
    saveSettingsBtn: 'Save settings',
  },
  share: {
    title: 'Share plan',
    subtitle: 'Direct link, PNG invite card, QR code, or device transfer.',
    tabWhatsapp: 'Link & Chat',
    tabQr: 'QR Code',
    tabDevice: 'Other device',
    directLinkLabel: 'Direct calendar link',
    whatsappPreviewLabel: 'WhatsApp / Telegram preview',
    copyMessageBtn: 'Copy message',
    generatingCard: 'Generating card...',
    downloadCardBtn: 'Download invite card (PNG)',
    cardSharedToast: 'Card shared',
    cardDownloadedToast: 'PNG invite card downloaded',
    cardErrorToast: 'Could not generate PNG card',
    missingFriendsLabel: (names) => `Waiting for a reply from: ${names}`,
    nudgeWhatsappBtn: 'Nudge on WhatsApp',
    qrDesc: 'Scan this QR code with any phone to open the plan instantly without typing.',
    qrAlt: 'Invite QR code',
    deviceDescBefore: 'Scan this personal QR or copy the link to keep editing with ',
    deviceDescBold: 'your same profile',
    deviceDescAfter: ' (and organizer permissions if you have them) on another phone or computer.',
    deviceQrAlt: 'Session transfer QR code',
    deviceLinkCopied: 'Personal link copied!',
    copyDeviceLinkBtn: 'Copy my personal link',
    devicePrivateWarning:
      '⚠️ Private link: do not share it in the group chat, it is only for your devices.',
    deviceNeedSession:
      'Join with your name first to generate your device transfer link.',
    msgConfirmedHeader: (title) => `*Date confirmed! ${title}*`,
    msgWhen: (dateLabel, time) => `When: *${dateLabel}*${time ? ` at ${time}` : ''}`,
    msgLocation: (location) => `Where: ${location}`,
    msgConfirmedCta: 'Confirm your attendance (RSVP), check rides, and add it to your calendar:',
    msgTopHeader: (title) => `*Let's plan "${title}"!*`,
    msgBestDaysTitle: (peopleLabel) => `*Best days so far* (${peopleLabel}):`,
    msgDayRow: (index, dateLabel, yesCount, voteInfo) =>
      `${index}. ${dateLabel} — ${yesCount} available${voteInfo}`,
    msgOpenCta: 'Open the calendar, mark the days you can make, and vote for your favorite:',
    msgEmptyHeader: (title) => `*Hey! Let's plan "${title}"*`,
    msgEmptyCta: 'Open the calendar, mark the days you are free, and vote for your favorite:',
    nudgeConfirmed: (names, title, dateRange, url) =>
      `Hey ${names}! We have a date for *${title}* (${dateRange}). Confirm your RSVP here:\n${url}`,
    nudgeOpen: (names, title, url) =>
      `Hey ${names}! We're just waiting on you to mark your days or vote in *${title}*:\n${url}`,
  },
  mobile: {
    navDates: 'Dates',
    navVote: 'Vote',
    navLogistics: 'Logistics',
    navGroup: 'Group',
    menuAria: 'More options',
    shareAria: 'Share plan',
    menuTitle: 'Plan options',
    menuProfile: 'My profile & PIN',
    menuJoin: 'Join with my name',
    menuSettings: 'Organizer settings',
    menuLanguage: 'Language',
    menuTheme: 'Appearance',
    themeDark: 'Dark',
    themeLight: 'Light',
    menuHome: 'Go home',
    planInfoTitle: 'Plan details',
    planInfoHint: 'Tap for details',
    topPillLabel: 'TOP',
    topPillFree: (yes, total) => `${yes}/${total} free`,
    topPillView: 'View',
    confirmedPillCta: 'Details',
    filter: 'Filter',
    onlyMe: 'Only me',
    paintCta: 'Mark my days',
    paintHint: 'Tap or drag over days · tap again to clear',
    paintDone: 'Done',
    paintYes: 'Yes',
    paintMaybe: 'Maybe',
    paintNo: 'No',
    voteModeRanking: 'Ranking',
    voteModeMatrix: 'Comparison',
    logPolls: 'Place',
    logChecklist: 'List',
    logCarpool: 'Cars',
    participantsTitle: (count) => `Participants (${count})`,
    onlineTag: 'online',
    joinCardTitle: 'Join the plan',
    joinCardDesc: 'Add your name to mark days, vote and comment. No sign-up.',
    myCardHint: 'Your changes are saved and synced instantly.',
    editProfileBtn: 'Edit',
    matrixScrollHint: 'Swipe to see more dates →',
  },
  avatar: {
    onlineSuffix: ' · Online',
    requiredSuffix: ' · Required',
    onlineAria: 'Online',
    requiredAria: 'Required',
  },
};

export const TRANSLATIONS: Record<Language, Translations> = {
  es: ES,
  en: EN,
};

interface I18nContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: Translations;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => getInitialLanguage());

  useEffect(() => {
    saveLanguage(language);
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute('content', TRANSLATIONS[language].meta.homeDescription);
    }
  }, [language]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev) => (prev === 'es' ? 'en' : 'es'));
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      toggleLanguage,
      t: TRANSLATIONS[language],
    }),
    [language, setLanguage, toggleLanguage]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
}
