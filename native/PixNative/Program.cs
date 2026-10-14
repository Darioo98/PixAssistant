using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PixNative;

/// <summary>
/// Ciclo richiesta/risposta su stdin/stdout. Ogni riga in ingresso è
/// {"id":n,"cmd":"...","args":{...}}; ogni risposta è {"id":n,"ok":true,"result":...}
/// oppure {"id":n,"ok":false,"error":"..."}. Nessun segreto viene mai scritto su stderr.
/// </summary>
internal static class Program
{
    private const string Version = "0.1.0";

    private static int Main()
    {
        var stdout = Console.OpenStandardOutput();
        using var writer = new StreamWriter(stdout) { AutoFlush = true };
        using var reader = new StreamReader(Console.OpenStandardInput());

        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            int? id = null;
            JsonObject response;
            try
            {
                var req = JsonNode.Parse(line)?.AsObject() ?? throw new InvalidDataException("bad-request");
                id = req["id"]?.GetValue<int>();
                var cmd = req["cmd"]?.GetValue<string>() ?? throw new InvalidDataException("missing-cmd");
                var args = req["args"] as JsonObject ?? new JsonObject();
                response = new JsonObject { ["id"] = id, ["ok"] = true, ["result"] = Dispatch(cmd, args) };
            }
            catch (Exception ex)
            {
                response = new JsonObject { ["id"] = id, ["ok"] = false, ["error"] = ex.Message };
            }
            writer.WriteLine(response.ToJsonString());
        }
        return 0;
    }

    private static JsonNode? Dispatch(string cmd, JsonObject args) => cmd switch
    {
        "ping" => new JsonObject { ["version"] = Version },
        "notificationState" => NotificationState.Query(),
        _ => throw new NotSupportedException($"unknown-cmd:{cmd}")
    };
}

/// <summary>Stato "non disturbare" di Windows: schermo intero, presentazione, giochi D3D.</summary>
internal static class NotificationState
{
    [DllImport("shell32.dll")]
    private static extern int SHQueryUserNotificationState(out int state);

    public static JsonNode Query()
    {
        var hr = SHQueryUserNotificationState(out var state);
        if (hr != 0) throw new ExternalException("SHQueryUserNotificationState", hr);
        var name = state switch
        {
            1 => "notPresent",
            2 => "busy",
            3 => "d3dFullScreen",
            4 => "presentation",
            5 => "acceptsNotifications",
            6 => "quietTime",
            7 => "app",
            _ => "unknown"
        };
        return JsonValue.Create(name)!;
    }
}
