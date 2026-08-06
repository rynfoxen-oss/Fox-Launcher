using System.Net;

namespace Launcher.Network;

/// <summary>
/// Shared <see cref="HttpClient"/> factory providing a retry policy, sane
/// timeouts and a consistent user agent. All launcher traffic goes through HTTPS.
/// </summary>
public sealed class Http
{
    private readonly HttpClient _client;
    private static readonly string UserAgent =
        $"FoxLauncher/{Launcher.Models.AppInfo.Version} (+https://github.com/rynfoxen-oss/Fox-Launcher)";

    public Http()
    {
        var handler = new SocketsHttpHandler
        {
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            AllowAutoRedirect = true,
            MaxAutomaticRedirections = 5,
            PooledConnectionLifetime = TimeSpan.FromMinutes(10),
            ConnectTimeout = TimeSpan.FromSeconds(15)
        };

        _client = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(60)
        };
        _client.DefaultRequestHeaders.UserAgent.ParseAdd(UserAgent);
    }

    /// <summary>Gets a string response with automatic retry on transient failures.</summary>
    public async Task<string> GetStringAsync(string url, CancellationToken ct = default, int retries = 3)
        => await RetryAsync(async token => await _client.GetStringAsync(url, token), ct, retries);

    /// <summary>Gets raw bytes with automatic retry.</summary>
    public async Task<byte[]> GetBytesAsync(string url, CancellationToken ct = default, int retries = 3)
        => await RetryAsync(async token => await _client.GetByteArrayAsync(url, token), ct, retries);

    /// <summary>Sends a POST form and returns the string response.</summary>
    public async Task<string> PostFormAsync(string url, IEnumerable<KeyValuePair<string, string>> form, CancellationToken ct = default)
    {
        using var content = new FormUrlEncodedContent(form);
        using var response = await _client.PostAsync(url, content, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync(ct);
    }

    /// <summary>Sends a POST with JSON and returns the string response.</summary>
    public async Task<string> PostJsonAsync(string url, string json, string bearerToken = "", CancellationToken ct = default)
    {
        using var content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
        if (!string.IsNullOrEmpty(bearerToken))
        {
            content.Headers.TryAddWithoutValidation("Authorization", $"Bearer {bearerToken}");
        }
        using var response = await _client.PostAsync(url, content, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync(ct);
    }

    /// <summary>
    /// Sends a multipart/form-data request (used for file uploads such as
    /// Minecraft skins) and returns the string response.
    /// </summary>
    public async Task<string> SendMultipartAsync(
        HttpMethod method,
        string url,
        string bearerToken,
        IEnumerable<KeyValuePair<string, string>> fields,
        string fileFieldName,
        string fileName,
        byte[] fileBytes,
        CancellationToken ct = default)
    {
        using var content = new MultipartFormDataContent();
        foreach (var (key, value) in fields)
        {
            content.Add(new StringContent(value), key);
        }

        var fileContent = new ByteArrayContent(fileBytes);
        fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
        content.Add(fileContent, fileFieldName, fileName);

        using var request = new HttpRequestMessage(method, url) { Content = content };
        if (!string.IsNullOrEmpty(bearerToken))
        {
            request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {bearerToken}");
        }
        using var response = await _client.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync(ct);
    }

    /// <summary>Sends a DELETE request and returns the string response.</summary>
    public async Task<string> DeleteAsync(string url, string bearerToken = "", CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, url);
        if (!string.IsNullOrEmpty(bearerToken))
        {
            request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {bearerToken}");
        }
        using var response = await _client.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync(ct);
    }

    /// <summary>Opens a stream for the URL (used by the download manager).</summary>
    public Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, HttpCompletionOption completion, CancellationToken ct)
        => _client.SendAsync(request, completion, ct);

    /// <summary>Creates a request message for a URL (download manager uses this to resume).</summary>
    public HttpRequestMessage CreateRequest(HttpMethod method, string url)
        => new(method, url);

    private static async Task<T> RetryAsync<T>(Func<CancellationToken, Task<T>> action, CancellationToken ct, int retries)
    {
        var delay = TimeSpan.FromMilliseconds(500);
        Exception? last = null;
        for (var attempt = 0; attempt <= retries; attempt++)
        {
            try
            {
                return await action(ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                last = ex;
                if (attempt >= retries) break;
            }

            await Task.Delay(delay, ct);
            delay *= 2;
        }
        throw last ?? new HttpRequestException("Request failed after retries.");
    }
}
