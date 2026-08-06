import { useEffect, useRef, useState } from "react";
import {
  Copy, Expand, Hand, MessageSquareText, Mic, MicOff, MonitorUp, PhoneOff,
  Send, Users, Video, VideoOff, Volume2, VolumeX, X
} from "lucide-react";
import { io } from "socket.io-client";
import { api, SOCKET_URL, socketOptions } from "../lib/api";
import { Modal } from "../components/Modal";

const DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

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
  const [status, setStatus] = useState("Connecting securely…");
  const [elapsed, setElapsed] = useState("00:00");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const localVideoRef = useRef();
  const localStreamRef = useRef();
  const displayStreamRef = useRef();
  const socketRef = useRef();
  const peersRef = useRef(new Map());
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);

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
      peersRef.current.get(socketId)?.close();
      peersRef.current.delete(socketId);
      setParticipants((current) => current.filter((participant) => participant.socketId !== socketId));
    }

    function createPeer(socketId, participantUser) {
      if (peersRef.current.has(socketId)) return peersRef.current.get(socketId);
      const peer = new RTCPeerConnection({ iceServers: iceServersRef.current });
      peersRef.current.set(socketId, peer);
      localStreamRef.current?.getTracks().forEach((track) => peer.addTrack(track, localStreamRef.current));
      peer.onicecandidate = (event) => {
        if (event.candidate) socketRef.current?.emit("meeting:signal", { target: socketId, signal: { candidate: event.candidate } });
      };
      peer.ontrack = (event) => upsertParticipant(socketId, { user: participantUser, stream: event.streams[0] });
      peer.onconnectionstatechange = () => {
        if (["failed", "closed"].includes(peer.connectionState)) removeParticipant(socketId);
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
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: !isAudioOnly });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
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
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const socket = io(SOCKET_URL, socketOptions());
      socketRef.current = socket;
      socket.on("connect_error", () => setStatus("Realtime connection unavailable. Retrying..."));
      socket.on("disconnect", () => {
        setStatus("Reconnecting securely...");
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
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            socket.emit("meeting:signal", { target: from, signal: { answer: peer.localDescription } });
          } else if (signal.answer) {
            await peer.setRemoteDescription(signal.answer);
          } else if (signal.candidate) {
            await peer.addIceCandidate(signal.candidate);
          }
        } catch (error) {
          console.error("Meeting signal failed", error);
        }
      });
      socket.on("meeting:chat", (incoming) => setChat((current) => [...current, incoming]));
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
            const peer = createPeer(participant.socketId, participant.user);
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            socket.emit("meeting:signal", { target: participant.socketId, signal: { offer: peer.localDescription } });
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
