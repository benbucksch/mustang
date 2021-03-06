/**
 * This module checks for new mail, using the IMAP standard protocol
 * and the emailjs.org JS library.
 */

import ImapClient, { LOG_LEVEL_NONE, LOG_LEVEL_ERROR, LOG_LEVEL_WARN, LOG_LEVEL_INFO, LOG_LEVEL_DEBUG, LOG_LEVEL_ALL } from "emailjs-imap-client";
import IMAPFolder from "../../mail/imap/IMAPFolder";
import MsgFolder from "../../account/MsgFolder";
import MailAccount from "../../mail/MailAccount";
import EMail from "../../mail/EMail";
import SQLAccount from "../../storage/SQLAccount";
import util from "../../../util/util";
util.importAll(util, global);
import { sanitize } from "../../../util/sanitizeDatatypes";

/**
 * Holds and manages login state of one IMAP account
 */
export default class IMAPAccount extends MailAccount {
  constructor(accountID) {
    super(accountID);
    this.kType = "imap";

    /**
     * {IMAPFolder}
     */
    this._inbox = null;
    //this._inbox = new MsgFolder("INBOX", "INBOX", this);
    //this._folders.set("INBOX", this._inbox);

    /**
     * Lists |ImapClient|s for this account
     * {Array of ImapClient}
     */
    this._connections = new ArrayColl();
  }

  get isLoggedIn() {
    return !!this._connections.length;
  }

  /**
   * Some of the unchecked mails (headers) in all folders.
   * Count depends on |peekMails|.
   * {Collection of EMail}
   */
  get messages() {
    let coll = null;
    this._folders.forEach(folder => {
      if (!coll) {
        coll = folder.messages;
      } else {
        coll = coll.concat(folder.messages);
      }
    });
    return coll;
  }

  /**
   * {Collection of IMAPFolder}
   */
  get folders() {
    return this._folders;
  }

  /**
   * {IMAPFolder}
   */
  get inbox() {
    return this._inbox;
  }

  /**
   * @param continuously {Boolean} start poller
   *    Currently ignored
   *    If true, return after login, but continue polling after returning.
   */
  async login(continuously) {
    try {
    let conn = await this._newConnection();
    if (this._folders.length <= 1 || !this._inbox) {
      await this.findFolders();
    }
    //notifyGlobalObservers("logged-in", { account: self });
    } catch (ex) { console.error(ex); throw ex; }
  }

  /**
   * @returns connection from ImapClient
   */
  async _newConnection() {
    assert(this.hostname, "Need to configure");
    assert(this._password, "Need password");
    var self = this;
    var conn = new ImapClient(this.hostname, this.port, {
      auth : {
        user: self.username,
        pass: self._password,
      },
      useSecureTransport : self.socketType == 2, // SSL
      requireTLS : self.socketType == 3, // STARTTLS
      //enableCompression : true,
      logLevel: LOG_LEVEL_WARN,
    });
    await conn.connect();
    this._connections.add(conn);
    return conn;
  }

  /**
   * Gets any free server connection.
   */
  get _connection() {
    // Implement with pool or
    // record which connections are busy.
    return this._connections.first;
  }

  async findFolders() {
    try {
    let rootMailboxes = await this._connection.listMailboxes();
    assert(rootMailboxes.root);
    let iterateMailboxes = (mailboxes, parentFolder) => {
      if (!mailboxes || !mailboxes.length) {
        return;
      }
      for (let mailbox of mailboxes) {
        try {
          let folder = IMAPFolder.fromLib(mailbox, this, parentFolder);
          iterateMailboxes(mailbox.children, folder);
          if (folder.name.toUpperCase() == "INBOX" && !parentFolder) {
            this._inbox = folder;
          }
        } catch (e) {
          console.error(e); // TODO
          console.log(mailbox);
        }
      };
    }
    iterateMailboxes(rootMailboxes.children, null);
    assert(this._inbox, "No INBOX found");
    } catch (ex) { console.error(ex); throw ex; }
  }

  /**
   * Closes open connections with the server,
   * and stops any possible ongoing periodic checks,
   * and deletes the stored credentials/password.
   */
  async logout() {
    this._deleteStoredPassword();
    await this.logoutButKeepCredentials();
  }

  /**
   * Closes open connections with the server,
   * and stops any possible ongoing periodic checks.
   */
  async logoutButKeepCredentials() {
    // logout modifies _conns, but forEach() copies
    this._connections.forEach(conn => {
      conn.logout(); // This is async, but do not wait for server response
      conn.close();
    });
    this._folders.clear();
    //notifyGlobalObservers("mail-check", { account: self });
    //notifyGlobalObservers("logged-out", { account: self });
  }
}
