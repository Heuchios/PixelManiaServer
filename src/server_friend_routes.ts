"use strict";

export {};

type PacketRecord = Record<string, any>;

interface FriendRoutesDeps extends Record<string, any> {}

function createServerFriendRoutes(deps: FriendRoutesDeps) {
  const {
    accountKey,
    accounts,
    cleanAccountName,
    findOnlinePlayerByUsername,
    makeRequestId,
    queueAccountsSave,
    requireAuthenticated,
    sendJson,
  } = deps;

  function sanitizeAccountNameArray(rawValue: unknown, limit = 200): string[] {
    if (!Array.isArray(rawValue)) return [];

    const safe: string[] = [];
    const seen = new Set<string>();
    for (const rawName of rawValue) {
      const clean = cleanAccountName(rawName);
      const key = accountKey(clean);
      if (clean === "" || key === "" || seen.has(key)) continue;

      seen.add(key);
      safe.push(clean);
      if (safe.length >= limit) break;
    }

    return safe;
  }

  function ensureFriendFields(account: PacketRecord | null | undefined): PacketRecord | null {
    if (!account || typeof account !== "object" || Array.isArray(account)) return null;

    account.friends = sanitizeAccountNameArray(account.friends, 200);
    account.friend_requests_in = sanitizeAccountNameArray(account.friend_requests_in || account.pending_friend_requests || [], 200);
    account.friend_requests_out = sanitizeAccountNameArray(account.friend_requests_out || [], 200);
    return account;
  }

  function accountNameArrayHas(list: unknown, username: unknown): boolean {
    const key = accountKey(username);
    if (key === "" || !Array.isArray(list)) return false;
    return list.some((entry) => accountKey(entry) === key);
  }

  function addAccountName(list: unknown, username: unknown): string[] {
    const clean = cleanAccountName(username);
    if (clean === "") return sanitizeAccountNameArray(list, 200);

    const safe = sanitizeAccountNameArray(list, 200);
    if (!accountNameArrayHas(safe, clean)) safe.push(clean);
    return sanitizeAccountNameArray(safe, 200);
  }

  function removeAccountName(list: unknown, username: unknown): string[] {
    const key = accountKey(username);
    if (key === "") return sanitizeAccountNameArray(list, 200);
    return sanitizeAccountNameArray(list, 200).filter((entry) => accountKey(entry) !== key);
  }

  function getAccountDisplayUsername(username: unknown): string {
    const clean = cleanAccountName(username);
    if (clean === "") return "";
    const account = accounts.get(accountKey(clean));
    return account?.username || clean;
  }

  function getFriendAccount(username: unknown): PacketRecord | null {
    const clean = cleanAccountName(username);
    if (clean === "") return null;
    const account = accounts.get(accountKey(clean)) || null;
    return ensureFriendFields(account);
  }

  function buildFriendEntry(username: unknown): PacketRecord {
    const displayUsername = getAccountDisplayUsername(username);
    const onlineEntry = findOnlinePlayerByUsername(displayUsername);
    const onlinePlayer = onlineEntry ? onlineEntry.player : null;
    const account = accounts.get(accountKey(displayUsername)) || null;

    return {
      username: displayUsername,
      name: displayUsername,
      online: Boolean(onlinePlayer),
      offline: !onlinePlayer,
      player_id: onlinePlayer?.id || "",
      world: onlinePlayer?.world || "",
      current_world: onlinePlayer?.world || "",
      last_seen_at: account ? String(account.last_seen_at || "") : "",
    };
  }

  function getFriendStatus(viewerUsername: unknown, targetUsername: unknown): string {
    const viewer = getFriendAccount(viewerUsername);
    const target = cleanAccountName(targetUsername);
    if (!viewer || target === "") return "none";
    if (accountKey(viewer.username) === accountKey(target)) return "self";
    if (accountNameArrayHas(viewer.friends, target)) return "friends";
    if (accountNameArrayHas(viewer.friend_requests_out, target)) return "outgoing";
    if (accountNameArrayHas(viewer.friend_requests_in, target)) return "incoming";
    return "none";
  }

  function buildFriendStatePayload(username: unknown, requestId = ""): PacketRecord {
    const account = getFriendAccount(username);
    if (!account) {
      return {
        type: "friend_state",
        ok: false,
        request_id: requestId,
        message: "Account not found.",
        friends: [],
        pending_incoming: [],
        pending_outgoing: [],
      };
    }

    return {
      type: "friend_state",
      ok: true,
      request_id: requestId,
      username: account.username,
      friends: account.friends.map(buildFriendEntry),
      pending_incoming: account.friend_requests_in.map(buildFriendEntry),
      pending_outgoing: account.friend_requests_out.map(buildFriendEntry),
    };
  }

  function sendFriendState(socket: unknown, username: unknown, requestId = ""): void {
    sendJson(socket, buildFriendStatePayload(username, requestId));
  }

  function sendFriendError(socket: unknown, data: PacketRecord, message: string): void {
    sendJson(socket, {
      type: "friend_error",
      ok: false,
      request_id: makeRequestId(data),
      message,
    });
  }

  function handleFriendListRequest(socket: unknown, player: PacketRecord, data: PacketRecord): void {
    if (!requireAuthenticated(socket, player, "friends")) return;
    sendFriendState(socket, player.account_username, makeRequestId(data));
  }

  function handleFriendRequest(socket: unknown, player: PacketRecord, data: PacketRecord): void {
    if (!requireAuthenticated(socket, player, "send friend request")) return;

    const sender = getFriendAccount(player.account_username);
    const targetUsername = cleanAccountName(data.target_username || data.username || data.target || "");
    const target = getFriendAccount(targetUsername);
    if (!sender) {
      sendFriendError(socket, data, "Sign on before sending friend requests.");
      return;
    }
    if (!target) {
      sendFriendError(socket, data, "That username is not registered.");
      return;
    }
    if (accountKey(sender.username) === accountKey(target.username)) {
      sendFriendError(socket, data, "You cannot add yourself.");
      return;
    }
    if (accountNameArrayHas(sender.friends, target.username)) {
      sendJson(socket, {
        type: "friend_request_sent",
        ok: true,
        request_id: makeRequestId(data),
        target_username: target.username,
        friend_status: "friends",
        message: target.username + " is already your friend.",
      });
      sendFriendState(socket, sender.username, makeRequestId(data));
      return;
    }
    if (accountNameArrayHas(sender.friend_requests_out, target.username)) {
      sendJson(socket, {
        type: "friend_request_sent",
        ok: true,
        request_id: makeRequestId(data),
        target_username: target.username,
        friend_status: "outgoing",
        message: "Friend request already sent to " + target.username + ".",
      });
      sendFriendState(socket, sender.username, makeRequestId(data));
      return;
    }

    if (accountNameArrayHas(sender.friend_requests_in, target.username)) {
      sender.friend_requests_in = removeAccountName(sender.friend_requests_in, target.username);
      target.friend_requests_out = removeAccountName(target.friend_requests_out, sender.username);
      sender.friends = addAccountName(sender.friends, target.username);
      target.friends = addAccountName(target.friends, sender.username);
      queueAccountsSave();

      sendJson(socket, {
        type: "friend_request_accepted",
        ok: true,
        request_id: makeRequestId(data),
        friend_username: target.username,
        message: "You and " + target.username + " are now friends.",
      });
      sendFriendState(socket, sender.username, makeRequestId(data));

      const targetRecord = findOnlinePlayerByUsername(target.username);
      if (targetRecord) {
        sendJson(targetRecord.socket, {
          type: "friend_request_accepted",
          ok: true,
          friend_username: sender.username,
          message: sender.username + " accepted your friend request.",
        });
        sendFriendState(targetRecord.socket, target.username);
      }
      return;
    }

    sender.friend_requests_out = addAccountName(sender.friend_requests_out, target.username);
    target.friend_requests_in = addAccountName(target.friend_requests_in, sender.username);
    queueAccountsSave();

    sendJson(socket, {
      type: "friend_request_sent",
      ok: true,
      request_id: makeRequestId(data),
      target_username: target.username,
      friend_status: "outgoing",
      message: "Friend request sent to " + target.username + ".",
    });
    sendFriendState(socket, sender.username, makeRequestId(data));

    const targetRecord = findOnlinePlayerByUsername(target.username);
    if (targetRecord) {
      sendJson(targetRecord.socket, {
        type: "friend_request_received",
        ok: true,
        from_username: sender.username,
        requester_username: sender.username,
        message: sender.username + " sent you a friend request.",
      });
      sendFriendState(targetRecord.socket, target.username);
    }
  }

  function handleFriendResponse(socket: unknown, player: PacketRecord, data: PacketRecord): void {
    if (!requireAuthenticated(socket, player, "answer friend request")) return;

    const receiver = getFriendAccount(player.account_username);
    const requesterUsername = cleanAccountName(data.from_username || data.requester_username || data.username || "");
    const requester = getFriendAccount(requesterUsername);
    const accepted = Boolean(data.accepted ?? data.accept ?? false);
    if (!receiver || !requester) {
      sendFriendError(socket, data, "Friend request not found.");
      return;
    }
    if (!accountNameArrayHas(receiver.friend_requests_in, requester.username)) {
      sendFriendError(socket, data, "No pending friend request from " + requester.username + ".");
      sendFriendState(socket, receiver.username, makeRequestId(data));
      return;
    }

    receiver.friend_requests_in = removeAccountName(receiver.friend_requests_in, requester.username);
    requester.friend_requests_out = removeAccountName(requester.friend_requests_out, receiver.username);

    if (accepted) {
      receiver.friends = addAccountName(receiver.friends, requester.username);
      requester.friends = addAccountName(requester.friends, receiver.username);
    }
    queueAccountsSave();

    sendJson(socket, {
      type: "friend_response_result",
      ok: true,
      accepted,
      request_id: makeRequestId(data),
      from_username: requester.username,
      friend_username: requester.username,
      message: accepted ? "You and " + requester.username + " are now friends." : "Declined friend request from " + requester.username + ".",
    });
    sendFriendState(socket, receiver.username, makeRequestId(data));

    const requesterRecord = findOnlinePlayerByUsername(requester.username);
    if (requesterRecord) {
      sendJson(requesterRecord.socket, {
        type: accepted ? "friend_request_accepted" : "friend_request_declined",
        ok: true,
        friend_username: receiver.username,
        from_username: receiver.username,
        message: accepted ? receiver.username + " accepted your friend request." : receiver.username + " declined your friend request.",
      });
      sendFriendState(requesterRecord.socket, requester.username);
    }
  }

  function notifyOnlineFriendsOfFriendState(username: unknown): void {
    const account = getFriendAccount(username);
    if (!account) return;

    for (const friendUsername of account.friends) {
      const friendRecord = findOnlinePlayerByUsername(friendUsername);
      if (!friendRecord) continue;
      sendFriendState(friendRecord.socket, friendUsername);
    }
  }

  return {
    accountNameArrayHas,
    addAccountName,
    buildFriendEntry,
    buildFriendStatePayload,
    ensureFriendFields,
    getAccountDisplayUsername,
    getFriendAccount,
    getFriendStatus,
    handleFriendListRequest,
    handleFriendRequest,
    handleFriendResponse,
    notifyOnlineFriendsOfFriendState,
    removeAccountName,
    sanitizeAccountNameArray,
    sendFriendError,
    sendFriendState,
  };
}

module.exports = {
  createServerFriendRoutes,
};
