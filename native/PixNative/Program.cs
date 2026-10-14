using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;
using Windows.Security.Credentials;
using Windows.Security.Cryptography;

namespace PixNative;

/// <summary>
/// Ciclo richiesta/risposta su stdin/stdout. Ogni riga in ingresso è
/// {"id":n,"cmd":"...","args":{...}}; ogni risposta è {"id":n,"ok":true,"result":...}
/// oppure {"id":n,"ok":false,"error":"..."}. Gli eventi spontanei (es. appunti)
/// sono righe {"event":"...", ...}. Nessun segreto viene mai scritto su stderr.
/// </summary>
internal static class Program
{
    private const string Version = "0.2.0";
    private static readonly object WriteLock = new();
    private static StreamWriter? _out;

    private static int Main()
    {
        _out = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        using var reader = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8);

        var pending = new List<Task>();
        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var copy = line;
            // Le richieste lente (Windows Hello aspetta l'utente) non bloccano le altre.
            pending.Add(Task.Run(() => Handle(copy)));
            pending.RemoveAll(t => t.IsCompleted);
        }
        // Input chiuso (Dock è uscito): completa le risposte in corso e termina.
        Task.WaitAll(pending.ToArray(), TimeSpan.FromSeconds(5));
        ClipboardWatcher.Stop();
        return 0;
    }

    private static async Task Handle(string line)
    {
        int? id = null;
        JsonObject response;
        try
        {
            var req = JsonNode.Parse(line)?.AsObject() ?? throw new InvalidDataException("bad-request");
            id = req["id"]?.GetValue<int>();
            var cmd = req["cmd"]?.GetValue<string>() ?? throw new InvalidDataException("missing-cmd");
            var args = req["args"] as JsonObject ?? new JsonObject();
            response = new JsonObject { ["id"] = id, ["ok"] = true, ["result"] = await Dispatch(cmd, args) };
        }
        catch (Exception ex)
        {
            response = new JsonObject { ["id"] = id, ["ok"] = false, ["error"] = ex.Message };
        }
        Emit(response);
    }

    public static void Emit(JsonObject msg)
    {
        lock (WriteLock) _out!.WriteLine(msg.ToJsonString());
    }

    private static async Task<JsonNode?> Dispatch(string cmd, JsonObject args) => cmd switch
    {
        "ping" => new JsonObject { ["version"] = Version },
        "notificationState" => NotificationState.Query(),
        "helloAvailable" => JsonValue.Create(await Hello.Available()),
        "helloEnroll" => await Hello.Enroll(Str(args, "name"), Str(args, "challenge")),
        "helloSign" => await Hello.Sign(Str(args, "name"), Str(args, "challenge")),
        "helloDelete" => await Hello.Delete(Str(args, "name")),
        "clipboardSetSecret" => JsonValue.Create(SecureClipboard.SetSecret(Str(args, "text"))),
        "clipboardClearIf" => JsonValue.Create(SecureClipboard.ClearIf((uint)args["seq"]!.GetValue<long>())),
        "clipboardWatch" => JsonValue.Create(ClipboardWatcher.Start()),
        _ => throw new NotSupportedException($"unknown-cmd:{cmd}")
    };

    private static string Str(JsonObject args, string key) =>
        args[key]?.GetValue<string>() ?? throw new ArgumentException($"missing-arg:{key}");
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

/// <summary>
/// Windows Hello tramite KeyCredentialManager. La chiave privata RSA vive nel
/// TPM (o nel contenitore protetto di Windows) e si usa solo dopo la verifica
/// dell'utente (volto, impronta o PIN). La firma PKCS#1 v1.5 di una sfida fissa
/// è deterministica: il processo main ne ricava la chiave che protegge la
/// cassaforte su questo PC. La firma non viene mai salvata.
/// </summary>
internal static class Hello
{
    public static async Task<bool> Available() => await KeyCredentialManager.IsSupportedAsync();

    public static async Task<JsonNode> Enroll(string name, string challengeB64)
    {
        var created = await KeyCredentialManager.RequestCreateAsync(name, KeyCredentialCreationOption.ReplaceExisting);
        if (created.Status != KeyCredentialStatus.Success) return Status(created.Status);
        return await SignWith(created.Credential, challengeB64);
    }

    public static async Task<JsonNode> Sign(string name, string challengeB64)
    {
        var opened = await KeyCredentialManager.OpenAsync(name);
        if (opened.Status != KeyCredentialStatus.Success) return Status(opened.Status);
        return await SignWith(opened.Credential, challengeB64);
    }

    public static async Task<JsonNode> Delete(string name)
    {
        try
        {
            await KeyCredentialManager.DeleteAsync(name);
        }
        catch (Exception)
        {
            // già assente
        }
        return new JsonObject { ["status"] = "success" };
    }

    private static async Task<JsonNode> SignWith(KeyCredential credential, string challengeB64)
    {
        var buffer = CryptographicBuffer.DecodeFromBase64String(challengeB64);
        var signed = await credential.RequestSignAsync(buffer);
        if (signed.Status != KeyCredentialStatus.Success) return Status(signed.Status);
        return new JsonObject
        {
            ["status"] = "success",
            ["signature"] = CryptographicBuffer.EncodeToBase64String(signed.Result)
        };
    }

    private static JsonNode Status(KeyCredentialStatus s) => new JsonObject
    {
        ["status"] = s switch
        {
            KeyCredentialStatus.UserCanceled => "canceled",
            KeyCredentialStatus.NotFound => "notFound",
            KeyCredentialStatus.UserPrefersPassword => "canceled",
            KeyCredentialStatus.SecurityDeviceLocked => "locked",
            _ => "error"
        }
    };
}

internal static class Win32
{
    [DllImport("user32.dll", SetLastError = true)] public static extern bool OpenClipboard(IntPtr owner);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool CloseClipboard();
    [DllImport("user32.dll", SetLastError = true)] public static extern bool EmptyClipboard();
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetClipboardData(uint format, IntPtr mem);
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr GetClipboardData(uint format);
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern uint RegisterClipboardFormat(string name);
    [DllImport("user32.dll")] public static extern bool IsClipboardFormatAvailable(uint format);
    [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] public static extern IntPtr GetClipboardOwner();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool AddClipboardFormatListener(IntPtr hwnd);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GlobalLock(IntPtr mem);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GlobalUnlock(IntPtr mem);
    [DllImport("kernel32.dll")] public static extern UIntPtr GlobalSize(IntPtr mem);

    public const uint CF_UNICODETEXT = 13;
    public const uint GMEM_MOVEABLE = 0x0002;

    /// <summary>Apre gli appunti riprovando: un'altra app potrebbe averli aperti in questo istante.</summary>
    public static void OpenClipboardRetry()
    {
        for (var i = 0; i < 10; i++)
        {
            if (OpenClipboard(IntPtr.Zero)) return;
            Thread.Sleep(30);
        }
        throw new IOException("clipboard-busy");
    }

    public static IntPtr Alloc(byte[] data)
    {
        var mem = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)data.Length);
        if (mem == IntPtr.Zero) throw new OutOfMemoryException();
        var ptr = GlobalLock(mem);
        Marshal.Copy(data, 0, ptr, data.Length);
        GlobalUnlock(mem);
        return mem;
    }
}

/// <summary>
/// Copia di una password: il testo va negli appunti insieme ai formati che
/// Windows e i gestori di cronologia rispettano per i contenuti sensibili,
/// così non finisce nella cronologia appunti (né di Windows né di Dock) né nel cloud.
/// </summary>
internal static class SecureClipboard
{
    private static readonly uint ExcludeMonitor = Win32.RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing");
    private static readonly uint CanIncludeHistory = Win32.RegisterClipboardFormat("CanIncludeInClipboardHistory");
    private static readonly uint CanUploadCloud = Win32.RegisterClipboardFormat("CanUploadToCloudClipboard");

    public static long SetSecret(string text)
    {
        Win32.OpenClipboardRetry();
        try
        {
            Win32.EmptyClipboard();
            var bytes = Encoding.Unicode.GetBytes(text + "\0");
            Win32.SetClipboardData(Win32.CF_UNICODETEXT, Win32.Alloc(bytes));
            var zero = BitConverter.GetBytes(0);
            Win32.SetClipboardData(ExcludeMonitor, Win32.Alloc(zero));
            Win32.SetClipboardData(CanIncludeHistory, Win32.Alloc(zero));
            Win32.SetClipboardData(CanUploadCloud, Win32.Alloc(zero));
            Array.Clear(bytes);
        }
        finally
        {
            Win32.CloseClipboard();
        }
        return Win32.GetClipboardSequenceNumber();
    }

    /// <summary>Svuota gli appunti solo se contengono ancora la password copiata da noi.</summary>
    public static bool ClearIf(uint seq)
    {
        if (Win32.GetClipboardSequenceNumber() != seq) return false;
        Win32.OpenClipboardRetry();
        try
        {
            return Win32.EmptyClipboard();
        }
        finally
        {
            Win32.CloseClipboard();
        }
    }

    /// <summary>true se il contenuto attuale è segnalato come sensibile (password manager, cassaforte).</summary>
    public static bool IsSensitive()
    {
        if (Win32.IsClipboardFormatAvailable(ExcludeMonitor)) return true;
        if (!Win32.IsClipboardFormatAvailable(CanIncludeHistory)) return false;
        if (!Win32.OpenClipboard(IntPtr.Zero)) return true; // nel dubbio non registriamo
        try
        {
            var h = Win32.GetClipboardData(CanIncludeHistory);
            if (h == IntPtr.Zero || (ulong)Win32.GlobalSize(h) < 4) return false;
            var p = Win32.GlobalLock(h);
            var value = Marshal.ReadInt32(p);
            Win32.GlobalUnlock(h);
            return value == 0;
        }
        finally
        {
            Win32.CloseClipboard();
        }
    }
}

/// <summary>
/// Ascolta i cambi degli appunti con AddClipboardFormatListener (nessun polling)
/// e invia un evento con il nome del processo che ha copiato e se il contenuto
/// è sensibile. Il contenuto vero lo legge il processo main, solo se serve.
/// </summary>
internal static class ClipboardWatcher
{
    private static Thread? _thread;
    private static System.Windows.Forms.Form? _window;

    public static bool Start()
    {
        if (_thread != null) return true;
        var ready = new ManualResetEventSlim();
        _thread = new Thread(() =>
        {
            _window = new ListenerWindow();
            _ = _window.Handle; // crea la finestra (invisibile)
            Win32.AddClipboardFormatListener(_window.Handle);
            ready.Set();
            System.Windows.Forms.Application.Run();
        })
        { IsBackground = true, Name = "clipboard" };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        ready.Wait(5000);
        return true;
    }

    public static void Stop()
    {
        try
        {
            _window?.Invoke(() => System.Windows.Forms.Application.ExitThread());
        }
        catch (Exception)
        {
            // già chiuso
        }
    }

    private sealed class ListenerWindow : System.Windows.Forms.Form
    {
        private const int WM_CLIPBOARDUPDATE = 0x031D;

        protected override void SetVisibleCore(bool value) => base.SetVisibleCore(false);

        protected override void WndProc(ref System.Windows.Forms.Message m)
        {
            if (m.Msg == WM_CLIPBOARDUPDATE) Notify();
            base.WndProc(ref m);
        }

        private static void Notify()
        {
            string owner = "";
            try
            {
                var hwnd = Win32.GetClipboardOwner();
                if (hwnd != IntPtr.Zero && Win32.GetWindowThreadProcessId(hwnd, out var pid) != 0)
                    owner = Process.GetProcessById((int)pid).ProcessName + ".exe";
            }
            catch (Exception)
            {
                // processo già terminato
            }
            bool sensitive;
            try
            {
                sensitive = SecureClipboard.IsSensitive();
            }
            catch (Exception)
            {
                sensitive = true;
            }
            Program.Emit(new JsonObject
            {
                ["event"] = "clipboard",
                ["seq"] = Win32.GetClipboardSequenceNumber(),
                ["owner"] = owner,
                ["sensitive"] = sensitive
            });
        }
    }
}
