import 'dart:convert';

/// Only server-defined in-app routes. Never execute a URL from notification data.
class PushDestination {
  const PushDestination(this.route, this.userId, this.eventId, this.elfId);
  final String route;
  final String userId;
  final String eventId;
  final String? elfId;

  static PushDestination? parse(Map<dynamic, dynamic> payload) {
    dynamic raw =
        payload['extras'] ?? payload['cn.jpush.android.EXTRA'] ?? payload;
    if (raw is String) {
      if (raw.length > 4096) return null;
      try {
        raw = jsonDecode(raw);
      } catch (_) {
        return null;
      }
    }
    if (raw is! Map) return null;
    final route = raw['route'];
    final userId = raw['userId'];
    final eventId = raw['eventId'];
    final elfId = raw['elfId'];
    if (!['home', 'wallet', 'identity', 'chat', 'elf'].contains(route) ||
        userId is! String ||
        !RegExp(r'^[A-Za-z0-9_-]{1,40}$').hasMatch(userId) ||
        eventId is! String ||
        !RegExp(r'^[A-Za-z0-9_-]{1,80}$').hasMatch(eventId)) {
      return null;
    }
    if (['chat', 'elf'].contains(route) &&
        (elfId is! String ||
            !RegExp(r'^[A-Za-z0-9_-]{1,80}$').hasMatch(elfId))) {
      return null;
    }
    return PushDestination(
        route as String, userId, eventId, elfId is String ? elfId : null);
  }
}
