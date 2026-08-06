import { useEffect, useRef, useState } from "react";
import {
  Copy, Expand, Hand, MessageSquareText, Mic, MicOff, MonitorUp, PhoneOff,
  Send, Users, Video, VideoOff, Volume2, VolumeX, X
} from "lucide-react";
import { io } from "socket.io-client";
import { api, SOCKET_URL, socketOptions } from "../lib/api";
import { Modal } from "../components/Modal";

const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];
const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: { ideal: 48000 }
};
const VIDEO_CONSTRAINTS = {
  width: { ideal: 640, max: 960 },
  height: { ideal: 360, max: 540 },
  frameRate: { ideal: 15, max: 20 }
};

export function MeetingRoom({ meeting, user, onLeave, onEndMeeting, onToast }) {
  const isAudioOnly = meeting.meeting_mode === "audio";
  const isOrganizer = meeting.organizer_id === user.id;
  const [participants, setParticipants] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(!isAudioOnly);
  const [screenOn, setScreenOn] = useState(false);
  const [raised, setRaised] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [panel, setPanel] = useState(null);
  const [chat, setChat] = useState([]);
  const [chatMessage, setChatMessage] = useState("");
  const [meetingChatPopup, setMeetingChatPopup] = useState(null);
  const [status, setStatus] = useState("Connecting securely…");
  const [elapsed, setElapsed] = useState("00:00");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const localVideoRef = useRef();
  const localStreamRef = useRef();
  const displayStreamRef = useRef();
  const socketRef = useRef();
  const panelRef = useRef(null);
  const peersRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const reconnectTimersRef = useRef(new Map());
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);

  useEffect(() => { panelRef.current = panel; }, [panel]);

  useEffect(() => {
    if (!meetingChatPopup) return;
    const timer = window.setTimeout(() => setMeetingChatPopup(null), 5000);
    return () => window.clearTimeout(timer);
  }, [meetingChatPopup]);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(`${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let disposed = false;

    function upsertParticipant(socketId, values) {
      setParticipants((current) => {
        const existing = current.find((participant) => participant.socketId === socketId);
        if (existing) return current.map((participant) => participant.socketId === socketId ? { ...participant, ...values } : participant);
        return [...current, { socketId, stream: null, raised: false, ...values }];
      });
    }

    function removeParticipant(socketId) {
      window.clearTimeout(reconnectTimersRef.current.get(socketId));
      reconnectTimersRef.current.delete(socketId);
      pendingCandidatesRef.current.delete(socketId);
      peersRef.current.get(socketId)?.close();
      peersRef.current.delete(socketId);
      setParticipants((current) => current.filter((participant) => participant.socketId !== socketId));
    }

    async function tuneSender(sender) {
      if (!sender.track) return;
      sender.track.contentHint = sender.track.kind === "audio" ? "speech" : "motion";
      try {
        const parameters = sender.getParameters();
        if (!parameters.encodings?.length) parameters.encodings = [{}];
        if (sender.track.kind === "audio") {
          parameters.encodings[0].maxBitrate = 96000;
          parameters.encodings[0].priority = "high";
          parameters.degradationPreference = "maintain-framerate";
        } else {
          const remoteCount = Math.max(1, peersRef.current.size);
          parameters.encodings[0].maxBitrate = Math.max(180000, Math.floor(900000 / remoteCount));
          parameters.encodings[0].maxFramerate = remoteCount >= 5 ? 12 : 18;
          parameters.encodings[0].scaleResolutionDownBy = remoteCount >= 7 ? 2 : remoteCount >= 4 ? 1.5 : 1;
          parameters.encodings[0].priority = "low";
          parameters.degradationPreference = "maintain-framerate";
        }
        await sender.setParameters(parameters);
      } catch {
        // Some browsers apply their own sender limits and reject these hints.
      }
    }

    function tuneAllSenders() {
      peersRef.current.forEach((peer) => peer.getSenders().forEach(tuneSender));
    }

    async function flushCandidates(socketId, peer) {
      const candidates = pendingCandidatesRef.current.get(socketId) || [];
      pendingCandidatesRef.current.delete(socketId);
      for (const candidate of candidates) {
        try { await peer.addIceCandidate(candidate); }
        catch (error) { console.warn("Could not apply a queued meeting candidate", error); }
      }
    }

    async function sendOffer(socketId, peer, restart = false) {
      if (peer.signalingState !== "stable") return;
      const offer = await peer.createOffer({ iceRestart: restart });
      await peer.setLocalDescription(offer);
      peer.getSenders().forEach(tuneSender);
      socketRef.current?.emit("meeting:signal", { target: socketId, signal: { offer: peer.localDescription } });
    }

    function scheduleReconnect(socketId, peer) {
      if (!peer._luxInitiator || reconnectTimersRef.current.has(socketId)) return;
      const timer = window.setTimeout(async () => {
        reconnectTimersRef.current.delete(socketId);
        if (!["disconnected", "failed"].includes(peer.connectionState)) return;
        try {
          setStatus("Restoring media connection...");
          peer.restartIce?.();
          await sendOffer(socketId, peer, true);
          if (["disconnected", "failed"].includes(peer.connectionState)) scheduleReconnect(socketId, peer);
        } catch (error) {
          console.warn("Meeting media reconnect failed", error);
          scheduleReconnect(socketId, peer);
        }
      }, peer.connectionState === "failed" ? 500 : 3500);
      reconnectTimersRef.current.set(socketId, timer);
    }

    function createPeer(socketId, participantUser, initiator = false) {
      if (peersRef.current.has(socketId)) {
        const existing = peersRef.current.get(socketId);
        existing._luxInitiator ||= initiator;
        return existing;
      }
      const peer = new RTCPeerConnection({ iceServers: iceServersRef.current, iceCandidatePoolSize: 10 });
      peer._luxInitiator = initiator;
      peersRef.current.set(socketId, peer);
      localStreamRef.current?.getTracks().forEach((track) => {
        const sender = peer.addTrack(track, localStreamRef.current);
        tuneSender(sender);
      });
      tuneAllSenders();
      peer.onicecandidate = (event) => {
        if (event.candidate) socketRef.current?.emit("meeting:signal", { target: socketId, signal: { candidate: event.candidate } });
      };
      peer.ontrack = (event) => upsertParticipant(socketId, { user: participantUser, stream: event.streams[0], connectionState: "connected" });
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          window.clearTimeout(reconnectTimersRef.current.get(socketId));
          reconnectTimersRef.current.delete(socketId);
          upsertParticipant(socketId, { connectionState: "connected" });
          setStatus("Connected");
        } else if (["disconnected", "failed"].includes(peer.connectionState)) {
          upsertParticipant(socketId, { connectionState: "reconnecting" });
          scheduleReconnect(socketId, peer);
        }
      };
      return peer;
    }

    async function start() {
      try {
        const meetingConfig = await api("/meetings/config");
        if (meetingConfig.iceServers?.length) iceServersRef.current = meetingConfig.iceServers;
      } catch {
        // The safe default still supports most peer-to-peer connections.
      }
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: isAudioOnly ? false : VIDEO_CONSTRAINTS });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
          setCameraOn(false);
          onToast("Camera unavailable. Joined with microphone only.");
        } catch {
          setMicOn(false);
          setCameraOn(false);
          onToast("Camera and microphone access is blocked. You can still join and view the meeting.");
        }
      }
      if (disposed) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }
      localStreamRef.current = stream;
      stream?.getAudioTracks().forEach((track) => { track.contentHint = "speech"; });
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const socket = io(SOCKET_URL, socketOptions());
      socketRef.current = socket;
      socket.on("connect_error", () => setStatus("Realtime connection unavailable. Retrying..."));
      socket.on("disconnect", () => {
        setStatus("Reconnecting securely...");
        reconnectTimersRef.current.forEach((timer) => window.clearTimeout(timer));
        reconnectTimersRef.current.clear();
        pendingCandidatesRef.current.clear();
        peersRef.current.forEach((peer) => peer.close());
        peersRef.current.clear();
        setParticipants([]);
      });
      socket.on("meeting:user-joined", ({ socketId, user: participantUser }) => {
        upsertParticipant(socketId, { user: participantUser });
      });
      socket.on("meeting:user-left", ({ socketId }) => removeParticipant(socketId));
      socket.on("meeting:signal", async ({ from, signal, user: participantUser }) => {
        try {
          const peer = createPeer(from, participantUser);
          upsertParticipant(from, { user: participantUser });
          if (signal.offer) {
            await peer.setRemoteDescription(signal.offer);
            await flushCandidates(from, peer);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            peer.getSenders().forEach(tuneSender);
            socket.emit("meeting:signal", { target: from, signal: { answer: peer.localDescription } });
          } else if (signal.answer) {
            await peer.setRemoteDescription(signal.answer);
            await flushCandidates(from, peer);
          } else if (signal.candidate) {
            if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
            else pendingCandidatesRef.current.set(from, [...(pendingCandidatesRef.current.get(from) || []), signal.candidate]);
          }
        } catch (error) {
          console.error("Meeting signal failed", error);
        }
      });
      socket.on("meeting:chat", (incoming) => {
        setChat((current) => [...current, incoming]);
        if (incoming.sender_id !== user.id && panelRef.current !== "chat") setMeetingChatPopup(incoming);
      });
      socket.on("meeting:hand", ({ socketId, raised: isRaised }) => upsertParticipant(socketId, { raised: isRaised }));
      socket.on("meeting:cancelled", ({ body }) => {
        onToast(body || "This meeting was cancelled by the organizer.");
        window.setTimeout(onLeave, 1800);
      });
      socket.on("meeting:ended", ({ message }) => {
        onToast(message || "The organizer ended this meeting.");
        window.setTimeout(onLeave, 900);
      });
      socket.on("connect", () => {
        setStatus("Connecting securely...");
        socket.emit("meeting:join", { roomId: meeting.id }, async (response) => {
          if (!response?.ok) {
            setStatus(response?.error || "Could not join meeting");
            return;
          }
          setStatus("Connected");
          for (const participant of response.participants) {
            upsertParticipant(participant.socketId, { user: participant.user });
            const peer = createPeer(participant.socketId, participant.user, true);
            await sendOffer(participant.socketId, peer);
          }
        });
      });
    }

    start();
    return () => {
      disposed = true;
      socketRef.current?.emit("meeting:leave");
      socketRef.current?.disconnect();
      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
      reconnectTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      reconnectTimersRef.current.clear();
      pendingCandidatesRef.current.clear();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [meeting.id, user.id]);

  function toggleMic() {
    const next = !micOn;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setMicOn(next);
  }

  function toggleCamera() {
    const next = !cameraOn;
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCameraOn(next);
  }

  async function shareScreen() {
    if (screenOn) return stopScreenShare();
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      displayStreamRef.current = display;
      const screenTrack = display.getVideoTracks()[0];
      peersRef.current.forEach((peer) => {
        peer.getSenders().find((sender) => sender.track?.kind === "video")?.replaceTrack(screenTrack);
      });
      if (localVideoRef.current) localVideoRef.current.srcObject = display;
      screenTrack.onended = stopScreenShare;
      setScreenOn(true);
    } catch {
      onToast("Screen sharing was cancelled");
    }
  }

  function stopScreenShare() {
    const display = displayStreamRef.current;
    displayStreamRef.current = null;
    display?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null;
    peersRef.current.forEach((peer) => {
      peer.getSenders().find((sender) => sender.track?.kind === "video")?.replaceTrack(cameraTrack);
    });
    if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    setScreenOn(false);
  }

  function toggleHand() {
    const next = !raised;
    setRaised(next);
    socketRef.current?.emit("meeting:hand", { raised: next });
  }

  function sendChat(event) {
    event.preventDefault();
    if (!chatMessage.trim()) return;
    socketRef.current?.emit("meeting:chat", { body: chatMessage });
    setChatMessage("");
  }

  function copyLink() {
    const url = new URL(window.location.href);
    url.searchParams.delete("channel");
    url.searchParams.set("meeting", meeting.id);
    navigator.clipboard.writeText(url.toString()).then(() => onToast("Internal meeting link copied"));
  }

  async function endForEveryone() {
    setEnding(true);
    try {
      await onEndMeeting(meeting);
      setConfirmEnd(false);
    } catch (error) {
      onToast(error.message);
    } finally {
      setEnding(false);
    }
  }

  const allParticipants = [{ socketId: "local", user, stream: localStream, raised, local: true }, ...participants];

  return (
    <div className={`meeting-room ${isAudioOnly ? "audio-call" : "video-call"}`}>
      <header className="meeting-topbar">
        <div><img src="/icons/luxsyncspace-192.png" alt="" /><span><b>{meeting.title || "LuxSyncspace meeting"}</b><small>{status} · Encrypted media connection</small></span></div>
        <div><time>{elapsed}</time><button onClick={copyLink}><Copy size={17} /> Copy invite link</button></div>
      </header>
      <main className={`meeting-stage ${panel ? "with-panel" : ""}`}>
        <section className={`meeting-grid participants-${Math.min(allParticipants.length, 6)}`}>
          {allParticipants.map((participant) => <VideoTile participant={participant} key={participant.socketId} localVideoRef={participant.local ? localVideoRef : null} cameraOn={participant.local ? cameraOn : true} speakerOn={speakerOn} />)}
        </section>
        {panel && <aside className="meeting-panel">
          <header><div><b>{panel === "people" ? "Participants" : "Meeting chat"}</b><small>{allParticipants.length} in this meeting</small></div><button onClick={() => setPanel(null)}><X size={18} /></button></header>
          {panel === "people" ? <div className="meeting-people">
            {allParticipants.map((participant) => <div key={participant.socketId}><span style={{ "--participant": participant.user?.avatar_color }}>{participant.user?.initials}</span><div><b>{participant.user?.full_name}{participant.local ? " (You)" : ""}</b><small>{participant.user?.title}</small></div>{participant.raised && <Hand size={17} />}</div>)}
          </div> : <><div className="meeting-chat">
            {chat.map((item) => <article key={item.id} className={item.sender_id === user.id ? "mine" : ""}><header><b>{item.sender_name}</b><time>{new Date(item.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></header><p>{item.body}</p></article>)}
            {!chat.length && <div className="meeting-chat-empty"><MessageSquareText size={25} /><p>Messages sent during this meeting appear here.</p></div>}
          </div><form className="meeting-chat-composer" onSubmit={sendChat}><input value={chatMessage} onChange={(event) => setChatMessage(event.target.value)} placeholder="Message everyone" /><button><Send size={17} /></button></form></>}
        </aside>}
      </main>
      <footer className={`meeting-controls ${isOrganizer ? "organizer-controls" : ""}`}>
        <div className="meeting-info"><span>{allParticipants.length}</span><small>participants</small></div>
        <div className="meeting-main-controls">
          <MeetingControl active={!micOn} onClick={toggleMic} icon={micOn ? Mic : MicOff} label={micOn ? "Mute" : "Unmute"} />
          {isAudioOnly && <MeetingControl active={!speakerOn} onClick={() => setSpeakerOn((enabled) => !enabled)} icon={speakerOn ? Volume2 : VolumeX} label={speakerOn ? "Speaker" : "Sound off"} />}
          {!isAudioOnly && <MeetingControl active={!cameraOn} onClick={toggleCamera} icon={cameraOn ? Video : VideoOff} label={cameraOn ? "Camera" : "Start video"} />}
          <button className="mobile-leave" onClick={onLeave}><span><PhoneOff size={20} /></span><small>Leave</small></button>
          {isOrganizer && <button className="mobile-end-for-all" onClick={() => setConfirmEnd(true)}><span><PhoneOff size={20} /></span><small>End for all</small></button>}
          {!isAudioOnly && <MeetingControl active={screenOn} onClick={shareScreen} icon={MonitorUp} label={screenOn ? "Stop sharing" : "Share screen"} />}
          <MeetingControl active={raised} onClick={toggleHand} icon={Hand} label={raised ? "Lower hand" : "Raise hand"} />
          <MeetingControl active={panel === "chat"} onClick={() => setPanel(panel === "chat" ? null : "chat")} icon={MessageSquareText} label="Chat" />
          <MeetingControl active={panel === "people"} onClick={() => setPanel(panel === "people" ? null : "people")} icon={Users} label="People" />
          <MeetingControl onClick={() => document.documentElement.requestFullscreen?.()} icon={Expand} label="Full screen" />
        </div>
        <div className="meeting-exit-actions desktop-leave"><button className="leave-meeting" onClick={onLeave}><PhoneOff size={18} /><span>Leave</span></button>{isOrganizer && <button className="end-meeting-for-all" onClick={() => setConfirmEnd(true)}><PhoneOff size={18} /><span>End for all</span></button>}</div>
      </footer>
      {meetingChatPopup && <button className="meeting-chat-popup" onClick={() => { setPanel("chat"); setMeetingChatPopup(null); }}>
        <span><MessageSquareText size={18} /></span><div><b>{meetingChatPopup.sender_name}</b><p>{meetingChatPopup.body}</p></div><small>Open chat</small>
      </button>}
      {confirmEnd && <Modal title="End meeting for everyone?" subtitle={meeting.title} onClose={() => !ending && setConfirmEnd(false)}><div className="end-meeting-confirm"><PhoneOff size={28} /><h3>Everyone will be disconnected</h3><p>Participants will not be able to rejoin this meeting after you end it.</p><div className="modal-actions"><button className="button button-secondary" onClick={() => setConfirmEnd(false)} disabled={ending}>Keep meeting open</button><button className="button button-danger" onClick={endForEveryone} disabled={ending}><PhoneOff size={16} /> {ending ? "Ending…" : "End for everyone"}</button></div></div></Modal>}
    </div>
  );
}

function MeetingControl({ active, onClick, icon: Icon, label }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span><Icon size={20} /></span><small>{label}</small></button>;
}

function VideoTile({ participant, localVideoRef, cameraOn, speakerOn }) {
  const remoteVideoRef = useRef();
  const videoRef = localVideoRef || remoteVideoRef;
  const [soundBlocked, setSoundBlocked] = useState(false);

  function resumePlayback() {
    if (!videoRef.current) return;
    videoRef.current.play()
      .then(() => setSoundBlocked(false))
      .catch(() => {
        if (!participant.local && speakerOn) setSoundBlocked(true);
      });
  }

  useEffect(() => {
    if (!videoRef.current || !participant.stream) return;
    videoRef.current.srcObject = participant.stream;
    resumePlayback();
  }, [participant.stream, speakerOn]);
  const hasVideo = cameraOn && participant.stream?.getVideoTracks().some((track) => track.enabled && track.readyState === "live");
  return <article className="meeting-tile">
    <video ref={videoRef} autoPlay playsInline muted={participant.local || !speakerOn} />
    {soundBlocked && <button className="meeting-enable-audio" onClick={resumePlayback}><Volume2 size={18} /> Tap to enable sound</button>}
    {!hasVideo && <div className="meeting-avatar" style={{ "--participant": participant.user?.avatar_color }}><span>{participant.user?.initials || "?"}</span></div>}
    {participant.raised && <span className="raised-hand"><Hand size={16} /> Hand raised</span>}
    <footer><b>{participant.user?.full_name || "Joining…"}{participant.local ? " (You)" : ""}</b>{participant.local && !participant.stream && <small>No media access</small>}</footer>
  </article>;
}
