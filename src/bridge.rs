//! Bridge server for Chrome extension communication.
//!
//! Persistent WebSocket server on 127.0.0.1:9333. The Chrome extension
//! connects as a client and proxies commands to the user's real browser.

use std::sync::Arc;

use tokio::sync::Mutex;

use crate::cdp::BridgeClient;

const BRIDGE_PORT: u16 = 9333;

/// Persistent bridge server state.
pub struct BridgeServer {
    client: Arc<Mutex<Option<BridgeClient>>>,
}

impl BridgeServer {
    /// Start the bridge server in the background.
    /// Returns immediately — listens for extension connections in a spawned task.
    pub fn start() -> Arc<Self> {
        let client: Arc<Mutex<Option<BridgeClient>>> = Arc::new(Mutex::new(None));

        let client_clone = client.clone();
        tokio::spawn(async move {
            if let Err(e) = listen_loop(client_clone).await {
                eprintln!("bridge: listener error: {}", e);
            }
        });

        Arc::new(Self { client })
    }

    /// Get the bridge client if extension is connected.
    pub async fn get_client(&self) -> Option<BridgeClient> {
        self.client.lock().await.clone()
    }
}

/// Background listener — accepts extension connections.
async fn listen_loop(client_slot: Arc<Mutex<Option<BridgeClient>>>) -> Result<(), String> {
    let addr: std::net::SocketAddr = format!("127.0.0.1:{}", BRIDGE_PORT)
        .parse()
        .map_err(|e| format!("bridge: bad addr: {}", e))?;

    let listener = match try_bind(addr) {
        Ok(l) => l,
        Err(_) => {
            // Port occupied — kill the old process and retry
            eprintln!("bridge: port {} in use, killing old process...", BRIDGE_PORT);
            let _ = std::process::Command::new("sh")
                .args(["-c", &format!("lsof -ti:{} | xargs kill", BRIDGE_PORT)])
                .status();
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            try_bind(addr).map_err(|e| format!("bridge: cannot bind {} ({})", addr, e))?
        }
    };

    eprintln!("bridge: listening on ws://{}", addr);

    loop {
        let (stream, _peer) = listener
            .accept()
            .await
            .map_err(|e| format!("bridge: accept error: {}", e))?;

        eprintln!("bridge: extension connected");

        // Build BridgeClient + attach — errors converted to String to stay Send
        match try_connect_and_attach(stream).await {
            Ok((cdp_client, tab_id)) => {
                eprintln!("bridge: attached to tab {}", tab_id);
                *client_slot.lock().await = Some(cdp_client);
            }
            Err(e) => {
                eprintln!("bridge: {}", e);
            }
        }
    }
}

/// Try to bind a TCP listener with SO_REUSEADDR.
fn try_bind(addr: std::net::SocketAddr) -> Result<tokio::net::TcpListener, std::io::Error> {
    let socket = tokio::net::TcpSocket::new_v4()?;
    socket.set_reuseaddr(true)?;
    socket.bind(addr)?;
    socket.listen(16)
}

/// Connect and attach in one step — isolates non-Send errors from the spawned task.
async fn try_connect_and_attach(
    stream: tokio::net::TcpStream,
) -> Result<(BridgeClient, i64), String> {
    let client = BridgeClient::connect_from_stream(stream)
        .await
        .map_err(|e| format!("handshake failed: {}", e))?;

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        client.send("Bridge.attach", Some(serde_json::json!({}))),
    )
    .await
    .map_err(|_| "attach timed out".to_string())?
    .map_err(|e| format!("attach failed: {}", e))?;

    if let Some(err) = result.get("error") {
        return Err(format!("attach error: {}", err));
    }

    let tab_id = result.get("tabId").and_then(|v| v.as_i64()).unwrap_or(-1);
    Ok((client, tab_id))
}

/// Try to connect via Chrome extension bridge (blocking, with timeout).
/// Used by CLI commands that don't have a persistent BridgeServer.
pub async fn try_extension_bridge() -> Result<BridgeClient, Box<dyn std::error::Error>> {
    let addr: std::net::SocketAddr = format!("127.0.0.1:{}", BRIDGE_PORT)
        .parse()
        .map_err(|e| format!("bridge: bad addr: {}", e))?;
    let socket = tokio::net::TcpSocket::new_v4()
        .map_err(|e| format!("bridge: socket: {}", e))?;
    socket
        .set_reuseaddr(true)
        .map_err(|e| format!("bridge: reuseaddr: {}", e))?;
    socket
        .bind(addr)
        .map_err(|e| format!("bridge: cannot bind port {} ({})", BRIDGE_PORT, e))?;
    let listener = socket
        .listen(16)
        .map_err(|e| format!("bridge: listen: {}", e))?;

    eprintln!("bridge: waiting for Chrome extension on ws://{}...", addr);

    let (stream, _peer) =
        tokio::time::timeout(std::time::Duration::from_secs(10), listener.accept())
            .await
            .map_err(|_| "bridge: no extension connected within 10s")?
            .map_err(|e| format!("bridge: accept failed: {}", e))?;

    eprintln!("bridge: extension connected");
    let client = BridgeClient::connect_from_stream(stream).await?;

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        client.send("Bridge.attach", Some(serde_json::json!({}))),
    )
    .await
    .map_err(|_| "bridge: attach timed out")?
    .map_err(|e| format!("bridge: attach failed: {}", e))?;

    if let Some(err) = result.get("error") {
        return Err(format!("bridge: attach error: {}", err).into());
    }

    let tab_id = result.get("tabId").and_then(|v| v.as_i64()).unwrap_or(-1);
    eprintln!("bridge: attached to tab {}", tab_id);
    Ok(client)
}

#[cfg(test)]
mod tests {
    use tokio::net::TcpListener;
    use super::*;

    #[test]
    fn bridge_port_is_9333() {
        assert_eq!(BRIDGE_PORT, 9333);
    }

    #[tokio::test]
    async fn bridge_server_starts_with_no_client() {
        // Bind to a random port to avoid conflicts
        let server = BridgeServer {
            client: Arc::new(Mutex::new(None)),
        };
        assert!(
            server.get_client().await.is_none(),
            "fresh server should have no client"
        );
    }

    #[tokio::test]
    async fn bridge_accepts_websocket_connection() {
        // Start a listener on a random port
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        // Spawn a task that accepts one connection and does WS handshake
        let server_task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            BridgeClient::connect_from_stream(stream)
                .await
                .map(|_| true)
                .map_err(|e| e.to_string())
        });

        // Connect as a WebSocket client
        let url = format!("ws://{}", addr);
        let (ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

        // Server should have accepted and completed handshake
        let client_result = server_task.await.unwrap();
        assert!(client_result.is_ok(), "handshake should succeed");

        drop(ws);
    }

    #[tokio::test]
    async fn bridge_client_send_receive_roundtrip() {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::Message;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        // Server side — wrap in channel to avoid Send bound on Box<dyn Error>
        let (tx, rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let client = BridgeClient::connect_from_stream(stream).await.unwrap();
            let _ = tx.send(client);
        });

        // Client side — echo server
        let url = format!("ws://{}", addr);
        let (ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        let (mut write, mut read) = ws.split();

        let echo_task = tokio::spawn(async move {
            if let Some(Ok(Message::Text(text))) = read.next().await {
                // Parse request, send response with matching id
                let req: serde_json::Value = serde_json::from_str(&text).unwrap();
                let id = req["id"].as_u64().unwrap();
                let resp = serde_json::json!({"id": id, "result": {"pong": true}});
                write
                    .send(Message::Text(serde_json::to_string(&resp).unwrap().into()))
                    .await
                    .unwrap();
            }
        });

        let client = rx.await.unwrap();

        // Send a request and get response
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            client.send("Bridge.ping", None),
        )
        .await
        .unwrap()
        .unwrap();

        assert_eq!(result["pong"], true);

        echo_task.await.unwrap();
    }
}
