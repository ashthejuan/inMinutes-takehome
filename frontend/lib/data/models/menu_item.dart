class MenuItem {
  const MenuItem({
    required this.id,
    required this.name,
    required this.pricePaise,
    required this.stock,
    required this.category,
    this.description,
    this.imageUrl,
  });

  final String id;
  final String name;
  final String? description;
  final int pricePaise;
  final int stock;
  final String category;
  final String? imageUrl;

  String get priceLabel {
    final rupees = pricePaise / 100;
    return '₹${rupees.toStringAsFixed(rupees.truncateToDouble() == rupees ? 0 : 2)}';
  }

  String get stockLabel {
    if (stock <= 0) {
      return 'Out of stock';
    }
    if (stock <= 5) {
      return 'Only $stock left';
    }
    return 'In stock';
  }

  factory MenuItem.fromJson(Map<String, dynamic> json) {
    return MenuItem(
      id: json['id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      pricePaise: json['price_paise'] as int,
      stock: json['stock'] as int,
      category: json['category'] as String,
      imageUrl: json['image_url'] as String?,
    );
  }
}
