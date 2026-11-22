export class NotificationService {
  constructor({
    getSession,
    canReceive,
    save,
    serverTimestamp
  }) {
    Object.assign(this, {
      getSession,
      canReceive,
      save,
      serverTimestamp
    });
  }
  create(notification) {
    const {
      user,
      role
    } = this.getSession();
    const recipientRole = notification.recipientRole || (notification.recipientUid === user?.uid ? role : '');
    if (recipientRole && !this.canReceive(recipientRole, notification.category)) return Promise.resolve(null);
    return this.save({
      recipientUid: notification.recipientUid || '',
      recipientRole: notification.recipientRole || '',
      category: notification.category || 'system',
      title: notification.title,
      message: notification.message,
      targetView: notification.targetView || 'dashboard',
      studentName: notification.studentName || '',
      studentId: notification.studentId || '',
      section: notification.section || '',
      ...(notification.eventId ? {
        eventId: notification.eventId
      } : {}),
      read: false,
      createdAt: this.serverTimestamp()
    });
  }
}
