import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ScreenUtilInit(
      designSize: const Size(400, 800), // baseline cho mobile
      minTextAdapt: true,
      builder: (context, child) {
        return MaterialApp(
          title: 'eLocker',
          theme: ThemeData(primarySwatch: Colors.blue),
          home: const MainScreen(),
        );
      },
    );
  }
}

class MainScreen extends StatefulWidget {
  const MainScreen({super.key});

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  List<Map<String, dynamic>> devices = [];
  String ip = "";
  String port = "";
  int threshold = 0;
  bool isLoading = false;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      ip = prefs.getString("ip") ?? "127.0.0.1";
      port = prefs.getString("port") ?? "8080";
      threshold = prefs.getInt("threshold") ?? 50;
    });
  }

  Future<void> _refreshStatus() async {
    if (ip.isEmpty || port.isEmpty) return;
    setState(() => isLoading = true);

    try {
      final url = Uri.parse("http://$ip:$port/getStatus");
      final res = await http.post(url);
      if (res.statusCode == 200) {
        final List<dynamic> data = jsonDecode(res.body)["results"];
        setState(() {
          devices = data
              .map((e) => {"id": e["id"], "status": e["status"]})
              .toList();
        });
      } else {
        _showDialog("Failed to get status");
      }
    } catch (e) {
      _showDialog("Error: $e");
    } finally {
      setState(() => isLoading = false);
    }
  }

  Future<void> _setThreshold() async {
    if (ip.isEmpty || port.isEmpty) return;
    setState(() => isLoading = true);

    try {
      final url = Uri.parse("http://$ip:$port/setThreshold");
      final res = await http.post(
        url,
        headers: {"Content-Type": "application/json"},
        body: jsonEncode({"threshold": threshold}),
      );
      if (res.statusCode == 200) {
        _showDialog("OK");
      } else {
        _showDialog("Fail");
      }
    } catch (e) {
      _showDialog("Error: $e");
    } finally {
      setState(() => isLoading = false); // ✅ tắt loading
    }
  }

  void _showDialog(String msg) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text("Result"),
        content: Text(msg),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text("OK"),
          ),
        ],
      ),
    );
  }

  Icon _getBatteryIcon(String status) {
    switch (status) {
      case "charging":
        return const Icon(Icons.battery_charging_full, color: Colors.amber);
      case "fullcharged":
        return const Icon(Icons.battery_full, color: Colors.green);
      case "notcharge":
        return const Icon(Icons.battery_std, color: Colors.grey);
      default:
        return const Icon(Icons.battery_alert, color: Colors.grey);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("eLocker"),
        actions: [
          PopupMenuButton<String>(
            onSelected: (value) async {
              if (value == "settings") {
                final result = await Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const SettingsScreen()),
                );
                if (result == true) {
                  // ✅ chỉ reload khi Save thành công
                  _loadSettings();
                }
              }
            },
            itemBuilder: (context) => [
              const PopupMenuItem(value: "settings", child: Text("Settings")),
            ],
          ),
        ],
      ),
      body: Stack(
        children: [
          Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  ElevatedButton.icon(
                    onPressed: isLoading ? null : _refreshStatus,
                    icon: Icon(Icons.refresh, size: 16.sp),
                    label: Text("Refresh", style: TextStyle(fontSize: 16.sp)),
                  ),
                  const SizedBox(width: 10),
                  ElevatedButton.icon(
                    onPressed: isLoading ? null : _setThreshold,
                    icon: Icon(Icons.tune, size: 16.sp),
                    label: Text(
                      "Set Threshold",
                      style: TextStyle(fontSize: 16.sp),
                    ),
                  ),
                ],
              ),
              SizedBox(height: 15.sp),
              Expanded(
                child: ListView.builder(
                  itemCount: devices.length,
                  itemBuilder: (context, index) {
                    final d = devices[index];
                    return ListTile(
                      leading: Icon(
                        _getBatteryIcon(d["status"]).icon,
                        color: _getBatteryIcon(d["status"]).color,
                        size: 28.sp, // ✅ icon tự scale
                      ),
                      title: Text(
                        "ID: ${d["id"]}",
                        style: TextStyle(fontSize: 16.sp),
                      ),
                      subtitle: Text(
                        "Status: ${d["status"]}",
                        style: TextStyle(fontSize: 14.sp),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
          if (isLoading) // ✅ overlay khi loading
            Container(
              color: Colors.black54,
              child: const Center(
                child: CircularProgressIndicator(color: Colors.white),
              ),
            ),
        ],
      ),
    );
  }
}

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final TextEditingController ipCtrl = TextEditingController();
  final TextEditingController portCtrl = TextEditingController();
  final TextEditingController thresholdCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    ipCtrl.text = prefs.getString("ip") ?? "";
    portCtrl.text = prefs.getString("port") ?? "";
    thresholdCtrl.text = (prefs.getInt("threshold") ?? 50).toString();
  }

  Future<void> _saveSettings() async {
    final prefs = await SharedPreferences.getInstance();
    final ip = ipCtrl.text.trim();
    final port = portCtrl.text.trim();
    final threshold = int.tryParse(thresholdCtrl.text.trim()) ?? 50;

    await prefs.setString("ip", ip);
    await prefs.setString("port", port);
    await prefs.setInt("threshold", threshold);

    if (!mounted) return;
    Navigator.pop(context, true); // trả về true để MainScreen reload
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Settings")),
      body: SingleChildScrollView(
        // ✅ để khi hiện keyboard không bị lỗi
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              controller: ipCtrl,
              decoration: const InputDecoration(
                labelText: "IP Address",
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.text,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: portCtrl,
              decoration: const InputDecoration(
                labelText: "Port",
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: thresholdCtrl,
              decoration: const InputDecoration(
                labelText: "Threshold (mA)",
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 20),
            ElevatedButton(onPressed: _saveSettings, child: const Text("Save")),
          ],
        ),
      ),
    );
  }
}
