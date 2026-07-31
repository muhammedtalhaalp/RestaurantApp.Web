using System.ComponentModel.DataAnnotations;

namespace RestaurantApp.Web.Models
{
    public class CreateUserViewModel
    {
        [Required(ErrorMessage = "Ad Soyad zorunludur.")]
        public string FullName { get; set; }

        [Required(ErrorMessage = "Kullanıcı adı/E-posta zorunludur.")]
        public string Username { get; set; }

        [Required(ErrorMessage = "Şifre zorunludur.")]
        public string Password { get; set; }

        [Required(ErrorMessage = "Rol seçimi zorunludur.")]
        public string Role { get; set; } // "Admin", "Garson", "Mutfak"
    }
}