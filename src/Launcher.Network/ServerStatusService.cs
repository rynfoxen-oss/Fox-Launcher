using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Launcher.Utils;

namespace Launcher.Network;

/// <summary>
/// Pings Minecraft servers using the Server List Ping (SLP) protocol and
/// reports their MOTD, version and live player counts.
/// </summary>
public sealed class ServerStatusService
{
    private const int DefaultTimeoutMs = 5000;

    /// <summary>The result of a server ping.</summary>
    public sealed class ServerStatus
    {
        public bool Online { get; set; }
        public string Motd { get; set; } = "";
        public string Version { get; set; } = "";
        public int OnlinePlayers { get; set; }
        public int MaxPlayers { get; set; }
        public long LatencyMs { get; set; }
        public string? Error { get; set; }
    }

    public async Task<ServerStatus> PingAsync(string host, int port, CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            using var client = new TcpClient();
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeoutCts.CancelAfter(TimeSpan.FromMilliseconds(DefaultTimeoutMs));

            await client.ConnectAsync(host, port, timeoutCts.Token);
            await using var stream = client.GetStream();

            await stream.WriteAsync(BuildHandshake(host, port), timeoutCts.Token);
            await stream.WriteAsync(new byte[] { 0x01, 0x00 }, timeoutCts.Token); // status request

            await ReadVarIntAsync(stream, timeoutCts.Token); // packet length
            await ReadVarIntAsync(stream, timeoutCts.Token); // packet id (0)
            var json = await ReadStringAsync(stream, timeoutCts.Token);

            sw.Stop();
            return ParseStatus(json, sw.ElapsedMilliseconds);
        }
        catch (Exception ex)
        {
            sw.Stop();
            return new ServerStatus
            {
                Online = false,
                LatencyMs = sw.ElapsedMilliseconds,
                Error = ex.Message
            };
        }
    }

    private static ServerStatus ParseStatus(string json, long latencyMs)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        var status = new ServerStatus
        {
            Online = true,
            LatencyMs = latencyMs
        };

        if (root.TryGetProperty("version", out var version) && version.TryGetProperty("name", out var name))
            status.Version = name.GetString() ?? "";

        if (root.TryGetProperty("players", out var players))
        {
            if (players.TryGetProperty("online", out var online)) status.OnlinePlayers = online.GetInt32();
            if (players.TryGetProperty("max", out var max)) status.MaxPlayers = max.GetInt32();
        }

        if (root.TryGetProperty("description", out var desc))
            status.Motd = StripColorCodes(ExtractText(desc));

        return status;
    }

    private static string ExtractText(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.String) return element.GetString() ?? "";
        if (element.ValueKind != JsonValueKind.Object) return "";

        var sb = new StringBuilder();
        if (element.TryGetProperty("text", out var text)) sb.Append(text.GetString());
        if (element.TryGetProperty("extra", out var extra) && extra.ValueKind == JsonValueKind.Array)
        {
            foreach (var child in extra.EnumerateArray()) sb.Append(ExtractText(child));
        }
        return sb.ToString();
    }

    /// <summary>Removes Minecraft §-style formatting codes.</summary>
    private static string StripColorCodes(string text)
    {
        var sb = new StringBuilder(text.Length);
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] == '\u00A7') { i++; continue; }
            sb.Append(text[i]);
        }
        return sb.ToString().Trim();
    }

    private static byte[] BuildHandshake(string host, int port)
    {
        using var payload = new MemoryStream();
        WriteVarInt(payload, 0);   // packet id
        WriteVarInt(payload, -1);  // protocol version (-1 = unknown)
        WriteString(payload, host);
        WriteVarInt(payload, port);
        WriteVarInt(payload, 1);   // next state: status

        var body = payload.ToArray();
        using var packet = new MemoryStream();
        WriteVarInt(packet, body.Length);
        packet.Write(body);
        return packet.ToArray();
    }

    private static void WriteVarInt(Stream stream, int value)
    {
        var v = (uint)value;
        while (true)
        {
            if ((v & ~0x7Fu) == 0)
            {
                stream.WriteByte((byte)v);
                return;
            }
            stream.WriteByte((byte)((v & 0x7F) | 0x80));
            v >>= 7;
        }
    }

    private static void WriteString(Stream stream, string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        WriteVarInt(stream, bytes.Length);
        stream.Write(bytes);
    }

    private static async Task<int> ReadVarIntAsync(Stream stream, CancellationToken ct)
    {
        var result = 0;
        for (var i = 0; i < 5; i++)
        {
            var b = await ReadByteAsync(stream, ct);
            result |= (b & 0x7F) << (7 * i);
            if ((b & 0x80) == 0) return result;
        }
        throw new InvalidDataException("Malformed VarInt in server response.");
    }

    private static async Task<string> ReadStringAsync(Stream stream, CancellationToken ct)
    {
        var length = await ReadVarIntAsync(stream, ct);
        if (length <= 0 || length > 1 << 20) throw new InvalidDataException("Invalid server response length.");
        var buffer = new byte[length];
        await ReadExactlyAsync(stream, buffer, ct);
        return Encoding.UTF8.GetString(buffer);
    }

    private static async Task ReadExactlyAsync(Stream stream, byte[] buffer, CancellationToken ct)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset, buffer.Length - offset), ct);
            if (read == 0) throw new EndOfStreamException("Server closed the connection early.");
            offset += read;
        }
    }

    private static async Task<byte> ReadByteAsync(Stream stream, CancellationToken ct)
    {
        var buffer = new byte[1];
        await ReadExactlyAsync(stream, buffer, ct);
        return buffer[0];
    }
}
